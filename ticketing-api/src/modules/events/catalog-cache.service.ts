import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Redis } from 'ioredis';
import { REDIS } from '../../infra/redis/redis.module.js';
import { redisKeys } from '../../infra/redis/redis-keys.js';

/**
 * Cache-aside for public catalog reads. Detail keys are invalidated on every
 * manager write; search results are keyed by query and simply expire (short TTL).
 * Concurrent misses for the same key share one loader (single-flight per process).
 */
@Injectable()
export class CatalogCacheService {
  private readonly logger = new Logger(CatalogCacheService.name);
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async getOrLoad<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
    try {
      const cached = await this.redis.get(key);
      if (cached !== null) return JSON.parse(cached) as T;
    } catch (error) {
      this.logger.warn({ err: error, key }, 'Catalog cache read failed; loading from source');
    }

    const pending = this.inFlight.get(key) as Promise<T> | undefined;
    if (pending) return pending;
    const loading = load()
      .then(async (value) => {
        await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds).catch(() => undefined);
        return value;
      })
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, loading);
    return loading;
  }

  static searchKey(query: object): string {
    return redisKeys.eventSearchCache(createHash('sha256').update(JSON.stringify(query)).digest('hex').slice(0, 32));
  }

  async invalidateEvent(eventId: string): Promise<void> {
    await this.redis.del(redisKeys.eventCache(eventId), redisKeys.eventShowsCache(eventId)).catch(() => undefined);
  }

  async invalidateShow(showId: string, eventId: string): Promise<void> {
    await this.redis.del(redisKeys.showCache(showId), redisKeys.eventShowsCache(eventId)).catch(() => undefined);
  }
}
