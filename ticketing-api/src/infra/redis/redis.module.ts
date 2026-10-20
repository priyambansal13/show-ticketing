import { Global, Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { Env } from '../../config/env.js';

export const REDIS = Symbol('REDIS');

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const client = new Redis(config.get('REDIS_URL', { infer: true }), {
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
        });
        // Without a listener ioredis reports connection loss as an unhandled error; it reconnects on its own.
        const logger = new Logger('Redis');
        client.on('error', (error: Error) => logger.warn({ err: error.message }, 'Redis connection error'));
        return client;
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      // Server already unreachable — drop the socket without waiting for a QUIT reply.
      this.redis.disconnect();
    }
  }
}
