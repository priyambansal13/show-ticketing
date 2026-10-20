import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client.js';
import type { Env } from '../../config/env.js';

/** Single PrismaClient (and connection pool) per process. */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService<Env, true>) {
    // With driver adapters Prisma has no pool timeout of its own; pg's defaults
    // wait forever for a connection. Bound everything so a flash-sale spike
    // produces fast errors (back-pressure) instead of an unbounded queue.
    super({
      adapter: new PrismaPg({
        connectionString: config.get('DATABASE_URL', { infer: true }),
        max: config.get('DATABASE_POOL_MAX', { infer: true }),
        connectionTimeoutMillis: config.get('DATABASE_POOL_TIMEOUT_MS', { infer: true }),
        idleTimeoutMillis: 30_000,
        statement_timeout: config.get('DATABASE_STATEMENT_TIMEOUT_MS', { infer: true }),
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Connected to PostgreSQL');
  }

  /** Closed last: workers, consumers and the outbox relay stop in beforeApplicationShutdown. */
  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}
