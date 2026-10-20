import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Redis } from 'ioredis';
import { minorToDecimalString } from '../../common/money.js';
import type { SeatStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { REDIS } from '../../infra/redis/redis.module.js';
import { redisKeys } from '../../infra/redis/redis-keys.js';
import { sellableSeats, type SeatLayout } from '../events/schemas/seat-layout.schema.js';
import { SeatsGateway } from './seats.gateway.js';
import { withSeatCommands, type RedisWithSeatCommands } from './seat-hold.scripts.js';

/** Single-letter codes in the `avail:{showId}` hash. */
export const AVAILABILITY_CODE: Record<SeatStatus, string> = { AVAILABLE: 'A', HELD: 'H', BOOKED: 'B', BLOCKED: 'X' };
const CODE_STATUS: Record<string, SeatStatus> = { A: 'AVAILABLE', H: 'HELD', B: 'BOOKED', X: 'BLOCKED' };

/** The cache self-heals: even a missed update is corrected within this window. */
const AVAILABILITY_TTL_SECONDS = 60;
const MATERIALIZE_BATCH = 1000;

export interface ShowForMaterialize {
  id: string;
  eventId: string;
  pricing: Map<string, number>;
  currency: string;
}

/**
 * Seat inventory for shows: materialization from layouts, seat status reads
 * (Redis cache over PostgreSQL), manager blocking, and Redis hold keys.
 * PostgreSQL `show_seats` is the source of truth; everything in Redis is derived.
 */
@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);
  private readonly redis: RedisWithSeatCommands;
  /** Concurrent cache misses for one show share a single PostgreSQL read (per instance). */
  private readonly rebuilding = new Map<string, Promise<Map<string, SeatStatus>>>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) redis: Redis,
    @Optional() private readonly gateway?: SeatsGateway,
  ) {
    this.redis = withSeatCommands(redis);
  }

  /**
   * Creates one show_seats row per sellable layout seat. Idempotent (skips
   * existing rows), so a retried publish after a partial failure completes it.
   */
  async materialize(show: ShowForMaterialize, layout: Pick<SeatLayout, 'sections'>): Promise<number> {
    const rows = sellableSeats(layout).map((seat) => {
      const price = show.pricing.get(seat.priceTier);
      if (price === undefined) throw new Error(`show ${show.id} has no price for tier ${seat.priceTier}`);
      return {
        showId: show.id,
        eventId: show.eventId,
        ...seat,
        price: minorToDecimalString(price),
        currency: show.currency,
      };
    });
    let inserted = 0;
    await this.prisma.$transaction(async (tx) => {
      for (let i = 0; i < rows.length; i += MATERIALIZE_BATCH) {
        const { count } = await tx.showSeat.createMany({ data: rows.slice(i, i + MATERIALIZE_BATCH), skipDuplicates: true });
        inserted += count;
      }
    });
    await this.redis.del(redisKeys.seatAvailability(show.id));
    return inserted;
  }

  /** seatId → status for every seat of the show. */
  async seatStatuses(showId: string): Promise<Map<string, SeatStatus>> {
    const key = redisKeys.seatAvailability(showId);
    const cached = await this.redis.hgetall(key);
    if (Object.keys(cached).length > 0) {
      return new Map(Object.entries(cached).map(([seatId, code]) => [seatId, CODE_STATUS[code] ?? 'BOOKED']));
    }
    return this.rebuildAvailability(showId);
  }

  rebuildAvailability(showId: string): Promise<Map<string, SeatStatus>> {
    const pending = this.rebuilding.get(showId);
    if (pending) return pending;
    const rebuild = this.loadAvailability(showId).finally(() => this.rebuilding.delete(showId));
    this.rebuilding.set(showId, rebuild);
    return rebuild;
  }

  private async loadAvailability(showId: string): Promise<Map<string, SeatStatus>> {
    const seats = await this.prisma.showSeat.findMany({ where: { showId }, select: { seatId: true, status: true } });
    const statuses = new Map(seats.map((s) => [s.seatId, s.status]));
    if (seats.length > 0) {
      const key = redisKeys.seatAvailability(showId);
      await this.redis
        .multi()
        .del(key)
        .hset(key, Object.fromEntries(seats.map((s) => [s.seatId, AVAILABILITY_CODE[s.status]])))
        .expire(key, AVAILABILITY_TTL_SECONDS)
        .exec();
    }
    return statuses;
  }

  /**
   * Call AFTER the transaction that changed seat status has committed:
   * updates the cache and pushes the change to connected seat maps.
   */
  async publishSeatChange(showId: string, seatIds: string[], status: SeatStatus): Promise<void> {
    if (seatIds.length === 0) return;
    try {
      await this.redis.setAvailabilityIfExists(redisKeys.seatAvailability(showId), AVAILABILITY_CODE[status], ...seatIds);
    } catch (error) {
      // Cache is advisory: a failure here only delays the update until the TTL rebuild.
      this.logger.warn({ err: error, showId }, 'Failed to update seat availability cache');
    }
    this.gateway?.emitSeatChange(showId, seatIds, status);
  }

  /** Manager: AVAILABLE → BLOCKED. Returns the seats actually blocked. */
  async block(showId: string, seatIds: string[]): Promise<string[]> {
    return this.transition(showId, seatIds, 'AVAILABLE', 'BLOCKED');
  }

  /** Manager: BLOCKED → AVAILABLE. Returns the seats actually released. */
  async unblock(showId: string, seatIds: string[]): Promise<string[]> {
    return this.transition(showId, seatIds, 'BLOCKED', 'AVAILABLE');
  }

  /** Show cancellation: every AVAILABLE seat → BLOCKED (held/booked seats are released by their bookings first). */
  async blockAllAvailable(showId: string): Promise<number> {
    const changed = await this.prisma.$queryRaw<Array<{ seat_id: string }>>`
      UPDATE show_seats SET status = 'BLOCKED', version = version + 1, updated_at = now()
       WHERE show_id = ${showId} AND status = 'AVAILABLE'
      RETURNING seat_id`;
    await this.publishSeatChange(
      showId,
      changed.map((row) => row.seat_id),
      'BLOCKED',
    );
    return changed.length;
  }

  private async transition(showId: string, seatIds: string[], from: SeatStatus, to: SeatStatus): Promise<string[]> {
    const changed = await this.prisma.$queryRaw<Array<{ seat_id: string }>>`
      UPDATE show_seats SET status = ${to}::"SeatStatus", version = version + 1, updated_at = now()
       WHERE show_id = ${showId} AND seat_id = ANY(${seatIds}) AND status = ${from}::"SeatStatus"
      RETURNING seat_id`;
    const ids = changed.map((row) => row.seat_id);
    await this.publishSeatChange(showId, ids, to);
    return ids;
  }

  // ── Redis hold keys (fast pre-check in front of the PostgreSQL hold) ──

  async acquireHoldKeys(showId: string, seatIds: string[], bookingId: string, ttlMs: number): Promise<boolean> {
    const keys = seatIds.map((seatId) => redisKeys.seatHold(showId, seatId));
    return (await this.redis.holdSeats(...keys, bookingId, ttlMs)) === 1;
  }

  async releaseHoldKeys(showId: string, seatIds: string[], bookingId: string): Promise<void> {
    if (seatIds.length === 0) return;
    const keys = seatIds.map((seatId) => redisKeys.seatHold(showId, seatId));
    try {
      await this.redis.releaseSeats(...keys, bookingId);
    } catch (error) {
      // Keys expire on their own (TTL); PostgreSQL remains authoritative.
      this.logger.warn({ err: error, showId, bookingId }, 'Failed to release hold keys');
    }
  }
}
