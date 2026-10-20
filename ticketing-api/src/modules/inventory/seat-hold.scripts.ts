import type { Redis } from 'ioredis';

/**
 * Atomic multi-seat hold: SET NX PX every key, or none.
 * KEYS = hold keys, ARGV[1] = bookingId, ARGV[2] = ttl ms. Returns 1 / 0.
 */
const HOLD_SEATS = `
for i = 1, #KEYS do
  if redis.call('SET', KEYS[i], ARGV[1], 'NX', 'PX', ARGV[2]) == false then
    for j = 1, i - 1 do redis.call('DEL', KEYS[j]) end
    return 0
  end
end
return 1`;

/** Compare-and-delete: only removes keys still owned by this booking. Returns keys removed. */
const RELEASE_SEATS = `
local removed = 0
for i = 1, #KEYS do
  if redis.call('GET', KEYS[i]) == ARGV[1] then
    redis.call('DEL', KEYS[i])
    removed = removed + 1
  end
end
return removed`;

/** Updates fields of the availability hash only if it exists (a partial hash would hide other seats). */
const SET_AVAILABILITY_IF_EXISTS = `
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
for i = 2, #ARGV do redis.call('HSET', KEYS[1], ARGV[i], ARGV[1]) end
return 1`;

export interface SeatHoldCommands {
  holdSeats(...args: [...keys: string[], bookingId: string, ttlMs: number]): Promise<number>;
  releaseSeats(...args: [...keys: string[], bookingId: string]): Promise<number>;
  setAvailabilityIfExists(key: string, code: string, ...seatIds: string[]): Promise<number>;
}

export type RedisWithSeatCommands = Redis & SeatHoldCommands;

const registered = new WeakSet<Redis>();

export function withSeatCommands(redis: Redis): RedisWithSeatCommands {
  if (!registered.has(redis)) {
    redis.defineCommand('holdSeatsLua', { lua: HOLD_SEATS });
    redis.defineCommand('releaseSeatsLua', { lua: RELEASE_SEATS });
    redis.defineCommand('setAvailabilityLua', { lua: SET_AVAILABILITY_IF_EXISTS, numberOfKeys: 1 });
    registered.add(redis);
  }
  const r = redis as Redis & Record<string, (...args: unknown[]) => Promise<number>>;
  return Object.assign(redis, {
    holdSeats: (...args: unknown[]) => {
      const keys = args.slice(0, -2) as string[];
      return r['holdSeatsLua']!(keys.length, ...keys, ...args.slice(-2));
    },
    releaseSeats: (...args: unknown[]) => {
      const keys = args.slice(0, -1) as string[];
      return r['releaseSeatsLua']!(keys.length, ...keys, ...args.slice(-1));
    },
    setAvailabilityIfExists: (key: string, code: string, ...seatIds: string[]) => r['setAvailabilityLua']!(key, code, ...seatIds),
  }) as RedisWithSeatCommands;
}
