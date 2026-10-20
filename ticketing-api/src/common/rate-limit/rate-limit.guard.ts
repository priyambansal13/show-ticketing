import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { Redis } from 'ioredis';
import { REDIS } from '../../infra/redis/redis.module.js';
import { redisKeys } from '../../infra/redis/redis-keys.js';
import { DomainException } from '../errors/domain.exception.js';
import type { AuthUser } from '../auth/auth.decorators.js';

export interface RateLimitRule {
  /** Bucket name, e.g. "login" */
  scope: string;
  limit: number;
  windowSeconds: number;
  /** What identifies the caller. `ip+email` uses the lower-cased body.email. */
  by: 'ip' | 'user' | 'ip+email';
}

const RATE_LIMIT = 'rateLimit:rule';
export const RateLimit = (rule: RateLimitRule) => SetMetadata(RATE_LIMIT, rule);

/**
 * Fixed-window limiter in Redis (INCR + EXPIRE), shared by all API instances.
 * Applied globally; only routes decorated with @RateLimit are limited.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.getAllAndOverride<RateLimitRule | undefined>(RATE_LIMIT, [context.getHandler(), context.getClass()]);
    if (!rule || context.getType() !== 'http') return true;

    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const subject = this.subject(rule, req);
    const key = redisKeys.rateLimit(rule.scope, subject);

    const [[, count]] = (await this.redis.multi().incr(key).expire(key, rule.windowSeconds, 'NX').exec()) as [[Error | null, number]];

    const res = context.switchToHttp().getResponse<Response>();
    res.setHeader('RateLimit-Limit', rule.limit);
    res.setHeader('RateLimit-Remaining', Math.max(0, rule.limit - count));
    if (count > rule.limit) {
      const ttl = await this.redis.ttl(key);
      res.setHeader('Retry-After', Math.max(1, ttl));
      throw new DomainException('RATE_LIMITED', 'Too many requests, try again later', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }

  private subject(rule: RateLimitRule, req: Request & { user?: AuthUser }): string {
    const ip = req.ip ?? 'unknown';
    switch (rule.by) {
      case 'user':
        return req.user?.id ?? ip;
      case 'ip+email': {
        const email = (req.body as { email?: unknown } | undefined)?.email;
        return `${ip}:${typeof email === 'string' ? email.trim().toLowerCase().slice(0, 254) : '-'}`;
      }
      default:
        return ip;
    }
  }
}
