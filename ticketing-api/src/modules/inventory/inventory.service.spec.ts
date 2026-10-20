import type { Redis } from 'ioredis';
import type { PrismaService } from '../../infra/prisma/prisma.service.js';
import { InventoryService } from './inventory.service.js';
import type { SeatsGateway } from './seats.gateway.js';

/** Minimal Redis double: Lua commands registered via defineCommand become plain mocks. */
function redisDouble(overrides: Record<string, unknown> = {}) {
  const multi = {
    del: vi.fn().mockReturnThis(),
    hset: vi.fn().mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue([]),
  };
  const redis: Record<string, unknown> = {
    hgetall: vi.fn().mockResolvedValue({}),
    del: vi.fn().mockResolvedValue(1),
    multi: vi.fn(() => multi),
    defineCommand: vi.fn((name: string) => {
      redis[name] = vi.fn().mockResolvedValue(1);
    }),
    ...overrides,
  };
  return { redis: redis as unknown as Redis & Record<string, ReturnType<typeof vi.fn>>, multi };
}

const prismaDouble = (seats: Array<{ seatId: string; status: string }> = []) =>
  ({
    showSeat: { findMany: vi.fn().mockResolvedValue(seats), createMany: vi.fn().mockResolvedValue({ count: 2 }) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ showSeat: { createMany: vi.fn().mockResolvedValue({ count: 2 }) } }),
    ),
    $queryRaw: vi.fn().mockResolvedValue([{ seat_id: 'A1' }]),
  }) as unknown as PrismaService;

const layout = {
  sections: [
    {
      code: 'GOLD',
      name: 'Gold',
      priceTier: 'GOLD',
      rows: [
        {
          label: 'A',
          seats: [
            { id: 'A1', number: 1, x: 0, y: 0, type: 'REGULAR' as const },
            { id: 'A2', number: 2, x: 1, y: 0, type: 'REGULAR' as const },
          ],
        },
      ],
    },
  ],
};

describe('InventoryService', () => {
  it('materializes sellable seats with exact decimal prices and drops the cached availability', async () => {
    const { redis } = redisDouble();
    const prisma = prismaDouble();
    const service = new InventoryService(prisma, redis);
    const created = await service.materialize({ id: 's1', eventId: 'e1', pricing: new Map([['GOLD', 45050]]), currency: 'INR' }, layout);
    expect(created).toBe(2);
    expect(redis.del).toHaveBeenCalledWith('avail:s1');
  });

  it('refuses to materialize when a tier has no price', async () => {
    const service = new InventoryService(prismaDouble(), redisDouble().redis);
    await expect(service.materialize({ id: 's1', eventId: 'e1', pricing: new Map(), currency: 'INR' }, layout)).rejects.toThrow(
      /no price for tier GOLD/,
    );
  });

  it('reads statuses from the cache, mapping unknown codes to BOOKED (fail closed)', async () => {
    const { redis } = redisDouble({ hgetall: vi.fn().mockResolvedValue({ A1: 'A', A2: 'H', A3: 'B', A4: 'X', A5: '?' }) });
    const statuses = await new InventoryService(prismaDouble(), redis).seatStatuses('s1');
    expect(Object.fromEntries(statuses)).toEqual({ A1: 'AVAILABLE', A2: 'HELD', A3: 'BOOKED', A4: 'BLOCKED', A5: 'BOOKED' });
  });

  it('rebuilds the cache from PostgreSQL on a miss, and skips writing for shows without seats', async () => {
    const { redis, multi } = redisDouble();
    const withSeats = await new InventoryService(prismaDouble([{ seatId: 'A1', status: 'HELD' }]), redis).seatStatuses('s1');
    expect(Object.fromEntries(withSeats)).toEqual({ A1: 'HELD' });
    expect(multi.hset).toHaveBeenCalledWith('avail:s1', { A1: 'H' });
    expect(multi.expire).toHaveBeenCalledWith('avail:s1', 60);

    const empty = redisDouble();
    expect((await new InventoryService(prismaDouble([]), empty.redis).seatStatuses('s2')).size).toBe(0);
    expect(empty.multi.exec).not.toHaveBeenCalled();
  });

  it('treats the cache as advisory: a failed update still notifies seat maps', async () => {
    const { redis } = redisDouble();
    const gateway = { emitSeatChange: vi.fn() } as unknown as SeatsGateway;
    const service = new InventoryService(prismaDouble(), redis, gateway);
    redis['setAvailabilityLua']!.mockRejectedValueOnce(new Error('redis down'));
    await service.publishSeatChange('s1', ['A1'], 'BOOKED');
    expect(gateway.emitSeatChange).toHaveBeenCalledWith('s1', ['A1'], 'BOOKED');
    await service.publishSeatChange('s1', [], 'BOOKED');
    expect(gateway.emitSeatChange).toHaveBeenCalledTimes(1);
  });

  it('acquires and releases hold keys atomically, tolerating release failures', async () => {
    const { redis } = redisDouble();
    const service = new InventoryService(prismaDouble(), redis);
    redis['holdSeatsLua']!.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    expect(await service.acquireHoldKeys('s1', ['A1', 'A2'], 'b1', 1000)).toBe(true);
    expect(redis['holdSeatsLua']).toHaveBeenCalledWith(2, 'hold:s1:A1', 'hold:s1:A2', 'b1', 1000);
    expect(await service.acquireHoldKeys('s1', ['A1'], 'b2', 1000)).toBe(false);

    redis['releaseSeatsLua']!.mockRejectedValueOnce(new Error('redis down'));
    await expect(service.releaseHoldKeys('s1', ['A1'], 'b1')).resolves.toBeUndefined();
    await service.releaseHoldKeys('s1', [], 'b1');
    expect(redis['releaseSeatsLua']).toHaveBeenCalledTimes(1);
  });

  it('blocks and unblocks through conditional updates', async () => {
    const prisma = prismaDouble();
    const service = new InventoryService(prisma, redisDouble().redis);
    expect(await service.block('s1', ['A1', 'A2'])).toEqual(['A1']);
    expect(await service.unblock('s1', ['A1'])).toEqual(['A1']);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('registers Lua commands once per Redis client', () => {
    const { redis } = redisDouble();
    new InventoryService(prismaDouble(), redis);
    new InventoryService(prismaDouble(), redis);
    expect(redis.defineCommand).toHaveBeenCalledTimes(3);
  });
});
