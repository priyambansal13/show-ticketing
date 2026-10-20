import { Controller, Get, Header, HttpStatus, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { Public } from '../../common/auth/auth.decorators.js';
import { DomainException } from '../../common/errors/domain.exception.js';
import type { Env } from '../../config/env.js';
import { MetricsService } from './metrics.service.js';

/**
 * Prometheus scrape endpoint. Internal: block it at the ingress, and/or set
 * METRICS_TOKEN so scrapes must send `Authorization: Bearer <token>`.
 */
@ApiExcludeController()
@Public()
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async scrape(@Req() req: Request): Promise<string> {
    const token = this.config.get('METRICS_TOKEN', { infer: true });
    if (token) {
      const presented = Buffer.from(req.headers.authorization ?? '');
      const expected = Buffer.from(`Bearer ${token}`);
      if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
        throw new DomainException('UNAUTHORIZED', 'Metrics token required', HttpStatus.UNAUTHORIZED);
      }
    }
    req.res?.type(this.metrics.registry.contentType);
    return this.metrics.registry.metrics();
  }
}
