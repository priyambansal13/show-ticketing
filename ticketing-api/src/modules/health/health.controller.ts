import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { HealthCheck, HealthCheckService, HealthIndicatorService, MongooseHealthIndicator, type HealthCheckResult } from '@nestjs/terminus';
import { Redis } from 'ioredis';
import { Public } from '../../common/auth/auth.decorators.js';
import { KafkaService } from '../../infra/kafka/kafka.service.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { REDIS } from '../../infra/redis/redis.module.js';

const CHECK_TIMEOUT_MS = 1500;
/** Repeated probes within this window reuse the last result instead of hitting every store. */
const CHECK_CACHE_MS = 2000;

/**
 * Only the up/down status per dependency leaves the process. Driver error
 * messages contain internal hosts and ports, so they are dropped here (Terminus
 * still logs them server-side).
 */
function statusOnly(result: HealthCheckResult): HealthCheckResult {
  const strip = (section: Partial<HealthCheckResult['details']> | undefined): HealthCheckResult['details'] => {
    const out: HealthCheckResult['details'] = {};
    for (const [key, value] of Object.entries(section ?? {})) {
      if (value) out[key] = { status: value.status };
    }
    return out;
  };
  return { status: result.status, info: strip(result.info), error: strip(result.error), details: strip(result.details) };
}

@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicator: HealthIndicatorService,
    private readonly mongoose: MongooseHealthIndicator,
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly kafka: KafkaService,
  ) {}

  /** Process is up — used as the liveness probe. */
  @Get('live')
  @HealthCheck()
  live() {
    return this.health.check([]);
  }

  /** All dependencies reachable — used as the readiness probe. Kafka is checked when this instance relays the outbox. */
  @Get('ready')
  @HealthCheck()
  async ready(): Promise<HealthCheckResult> {
    try {
      return statusOnly(
        await this.health.check([
          this.indicator
            .check('postgres')
            .attempt(async () => {
              await this.prisma.$queryRaw`SELECT 1`;
            })
            .withTimeout(CHECK_TIMEOUT_MS)
            .cacheFor(CHECK_CACHE_MS),
          this.mongoose.pingCheck('mongodb').withTimeout(CHECK_TIMEOUT_MS).cacheFor(CHECK_CACHE_MS),
          this.indicator
            .check('redis')
            .attempt(async () => {
              await this.redis.ping();
            })
            .withTimeout(CHECK_TIMEOUT_MS)
            .cacheFor(CHECK_CACHE_MS),
          ...(this.kafka.enabled
            ? [
                this.indicator
                  .check('kafka')
                  .attempt(() => this.kafka.ping())
                  .withTimeout(3000)
                  .cacheFor(10_000),
              ]
            : []),
        ]),
      );
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw new ServiceUnavailableException(statusOnly(error.getResponse() as HealthCheckResult));
      }
      throw error;
    }
  }
}
