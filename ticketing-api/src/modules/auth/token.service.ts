import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Redis } from 'ioredis';
import { createHash, randomBytes } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import type { AuthUser } from '../../common/auth/auth.decorators.js';
import { DomainException } from '../../common/errors/domain.exception.js';
import type { Env } from '../../config/env.js';
import type { Role, User } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { REDIS } from '../../infra/redis/redis.module.js';

export const JWT_ISSUER = 'ticketing-api';
export const JWT_AUDIENCE = 'ticketing-web';

export interface AccessTokenClaims {
  sub: string;
  role: Role;
  status: User['status'];
  iat?: number;
}

const revokedKey = (userId: string) => `auth:revoked-before:${userId}`;

export interface ClientMeta {
  userAgent?: string;
  ip?: string;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

const invalidRefresh = () => new DomainException('INVALID_REFRESH_TOKEN', 'Session expired, please sign in again', HttpStatus.UNAUTHORIZED);

/**
 * Access tokens: short-lived JWT (HS256, iss/aud pinned).
 * Refresh tokens: 256-bit random, stored as SHA-256, rotated on every use; all
 * tokens from one login share a family — presenting an already-rotated token
 * revokes the entire family (theft detection).
 */
@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  get accessTtlSeconds(): number {
    return this.config.get('JWT_ACCESS_TTL_SECONDS', { infer: true });
  }

  get refreshTtlMs(): number {
    return this.config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) * 86_400_000;
  }

  signAccess(user: Pick<User, 'id' | 'role' | 'status'>): Promise<string> {
    const claims: AccessTokenClaims = { sub: user.id, role: user.role, status: user.status };
    return this.jwt.signAsync(claims, { expiresIn: this.accessTtlSeconds });
  }

  async verifyAccess(token: string): Promise<AuthUser> {
    const claims = await this.jwt.verifyAsync<AccessTokenClaims>(token);
    // Access tokens are stateless; a revocation marker invalidates those issued before it (suspension).
    const revokedBefore = await this.redis.get(revokedKey(claims.sub));
    if (revokedBefore !== null && (claims.iat ?? 0) <= Number(revokedBefore)) {
      throw new Error('access token revoked');
    }
    return { id: claims.sub, role: claims.role, status: claims.status };
  }

  /** Invalidates every access token issued so far for the user (the marker outlives the longest token). */
  async revokeAccessTokens(userId: string): Promise<void> {
    await this.redis.set(revokedKey(userId), String(Math.floor(Date.now() / 1000)), 'EX', this.accessTtlSeconds + 60);
  }

  /** Starts a new refresh-token family (login / register). Returns the raw token for the cookie. */
  async issueRefresh(userId: string, meta: ClientMeta, familyId: string = uuidv7()): Promise<string> {
    const raw = randomBytes(32).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: sha256(raw),
        expiresAt: new Date(Date.now() + this.refreshTtlMs),
        userAgent: meta.userAgent?.slice(0, 512),
        ip: meta.ip?.slice(0, 45),
      },
    });
    return raw;
  }

  /**
   * Exchanges a refresh token for a new one (same family). The user must
   * belong to the portal's role.
   */
  async rotate(raw: string, expectedRole: Role, meta: ClientMeta): Promise<{ user: User; refreshToken: string }> {
    const current = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(raw) },
      include: { user: true },
    });
    if (!current || current.user.role !== expectedRole) throw invalidRefresh();

    if (current.revokedAt) {
      // An already-rotated token came back: assume theft and kill the whole session family.
      await this.revokeFamily(current.familyId);
      this.logger.warn({ userId: current.userId, familyId: current.familyId }, 'Refresh token reuse detected');
      throw invalidRefresh();
    }
    if (current.expiresAt <= new Date() || current.user.status === 'SUSPENDED') throw invalidRefresh();

    const nextRaw = randomBytes(32).toString('base64url');
    await this.prisma.$transaction(async (tx) => {
      const next = await tx.refreshToken.create({
        data: {
          userId: current.userId,
          familyId: current.familyId,
          tokenHash: sha256(nextRaw),
          expiresAt: new Date(Date.now() + this.refreshTtlMs),
          userAgent: meta.userAgent?.slice(0, 512),
          ip: meta.ip?.slice(0, 45),
        },
      });
      // Conditional: two concurrent refreshes with the same token → only one wins.
      const { count } = await tx.refreshToken.updateMany({
        where: { id: current.id, revokedAt: null },
        data: { revokedAt: new Date(), replacedById: next.id },
      });
      if (count !== 1) throw invalidRefresh();
    });
    return { user: current.user, refreshToken: nextRaw };
  }

  /** Logout: revoke the presented token's whole family. Unknown tokens are ignored. */
  async revokeByRaw(raw: string): Promise<void> {
    const token = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(raw) } });
    if (token) await this.revokeFamily(token.familyId);
  }

  revokeFamily(familyId: string) {
    return this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Suspension / password change: end every session of the user. */
  revokeAllForUser(userId: string, tx: Pick<PrismaService, 'refreshToken'> = this.prisma) {
    return tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}
