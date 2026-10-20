import { HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'node:crypto';
import QRCode from 'qrcode';
import { v7 as uuidv7 } from 'uuid';
import type { AuthUser } from '../../common/auth/auth.decorators.js';
import { DomainException, notFound } from '../../common/errors/domain.exception.js';
import { decimalStringToMinor, minorToDecimalString } from '../../common/money.js';
import { pageOf } from '../../common/validation/zod.js';
import type { Env } from '../../config/env.js';
import { Prisma, type BookingStatus } from '../../generated/prisma/client.js';
import { MetricsService } from '../../infra/metrics/metrics.service.js';
import { OutboxService, TOPICS } from '../../infra/outbox/outbox.service.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { QUEUES, QueueService } from '../../infra/queue/queue.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ManagerCatalogService } from '../events/manager-catalog.service.js';
import { PublicCatalogService } from '../events/public-catalog.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import type { HoldSeats, ListBookingsQuery, ShowBookingsQuery } from './dto/booking.dto.js';
import { RefundRequests } from '../ledger/refund-requests.js';
import { createTicketCode, verifyTicketCode } from './ticket-code.js';

type Tx = Prisma.TransactionClient;

const REF_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newBookingRef = () => `BMS${Array.from({ length: 7 }, () => REF_ALPHABET[randomInt(REF_ALPHABET.length)]).join('')}`;

const BOOKING_INCLUDE = {
  items: { include: { showSeat: { select: { seatId: true, section: true, rowLabel: true, seatNumber: true } } } },
  payments: { select: { id: true, status: true, amount: true, createdAt: true }, orderBy: { createdAt: 'desc' as const } },
} satisfies Prisma.BookingInclude;
type BookingWithItems = Prisma.BookingGetPayload<{ include: typeof BOOKING_INCLUDE }>;

const tooManyHolds = () =>
  new DomainException('TOO_MANY_ACTIVE_HOLDS', 'Complete or release your current booking first', HttpStatus.CONFLICT);

const seatsUnavailable = (details?: Record<string, unknown>) =>
  new DomainException('SEATS_UNAVAILABLE', 'One or more selected seats are no longer available', HttpStatus.CONFLICT, details);

export interface ConfirmResult {
  showId: string;
  seatIds: string[];
}

/**
 * Seat holds and the booking lifecycle (docs/IMPLEMENTATION_PLAN.md §5 and the
 * booking-integrity skill). PostgreSQL is the authority; the database rejects
 * any inconsistent outcome at COMMIT. Redis/WebSocket updates happen only after
 * a successful commit.
 */
@Injectable()
export class BookingService implements OnModuleInit {
  private readonly logger = new Logger(BookingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly catalog: PublicCatalogService,
    private readonly managerCatalog: ManagerCatalogService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly refunds: RefundRequests,
    private readonly queues: QueueService,
    private readonly config: ConfigService<Env, true>,
    private readonly metrics: MetricsService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queues.worker<{ bookingId: string }>(QUEUES.bookingExpiry, async (job) =>
      job.name === 'sweep' ? this.sweepExpired() : this.expire(job.data.bookingId, 'timeout'),
    );
    this.queues.worker<{ showId: string }>(
      QUEUES.showCancellations,
      async (job) => (job.name === 'reconcile' ? this.reconcileCancelledShows() : this.processShowCancellation(job.data.showId)),
      { concurrency: 1 },
    );
    if (this.queues.workersEnabled) {
      // Safety nets (one schedule cluster-wide): expire stale holds; finish interrupted show cancellations.
      await this.queues.queue(QUEUES.bookingExpiry).upsertJobScheduler('expiry-sweeper', { every: 60_000 }, { name: 'sweep' });
      await this.queues
        .queue(QUEUES.showCancellations)
        .upsertJobScheduler('cancellation-reconciler', { every: 300_000 }, { name: 'reconcile' });
    }
  }

  private get holdTtlMs(): number {
    return this.config.get('SEAT_HOLD_TTL_SECONDS', { infer: true }) * 1000;
  }

  // ── Hold ────────────────────────────────────────────────────────────────

  async hold(customer: AuthUser, input: HoldSeats) {
    const maxSeats = this.config.get('MAX_SEATS_PER_BOOKING', { infer: true });
    if (input.seatIds.length > maxSeats) {
      throw new DomainException('TOO_MANY_SEATS', `At most ${maxSeats} seats per booking`);
    }
    const show = await this.catalog.saleableShow(input.showId);
    if (!show.onSale) throw new DomainException('SHOW_NOT_ON_SALE', 'Tickets for this show are not on sale', HttpStatus.CONFLICT);
    const maxHolds = this.config.get('MAX_ACTIVE_HOLDS_PER_USER', { infer: true });

    const bookingId = uuidv7();
    const holdUntil = new Date(Date.now() + this.holdTtlMs);
    const stopTimer = this.metrics.seatHoldDuration.startTimer();
    // 1. Fast gate: atomic Redis hold keys (all or nothing).
    if (!(await this.inventory.acquireHoldKeys(input.showId, input.seatIds, bookingId, this.holdTtlMs))) {
      this.metrics.seatHolds.inc({ result: 'conflict' });
      throw seatsUnavailable();
    }

    try {
      // 2. Authority: PostgreSQL. Booking first (show_seats.booking_id references it).
      await this.prisma.$transaction(async (tx) => {
        // Serialize this customer's holds so the active-hold limit cannot be raced (anti-hoarding).
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`hold:${customer.id}`}))`;
        const activeHolds = await tx.booking.count({
          where: { userId: customer.id, status: 'PENDING', holdExpiresAt: { gt: new Date() } },
        });
        if (activeHolds >= maxHolds) throw tooManyHolds();
        const seats = await tx.showSeat.findMany({
          where: { showId: input.showId, seatId: { in: input.seatIds } },
          select: { id: true, seatId: true, price: true, currency: true },
        });
        if (seats.length !== input.seatIds.length) {
          const known = new Set(seats.map((s) => s.seatId));
          throw new DomainException('SEAT_NOT_FOUND', 'Unknown seat', HttpStatus.BAD_REQUEST, {
            seatIds: input.seatIds.filter((id) => !known.has(id)),
          });
        }
        const total = seats.reduce((sum, s) => sum.plus(s.price), new Prisma.Decimal(0));
        await tx.booking.create({
          data: {
            id: bookingId,
            bookingRef: newBookingRef(),
            userId: customer.id,
            showId: input.showId,
            eventId: show.eventId,
            totalAmount: total,
            currency: seats[0]!.currency,
            holdExpiresAt: holdUntil,
            items: { create: seats.map((s) => ({ showSeatId: s.id, price: s.price })) },
          },
        });
        const held = await tx.$executeRaw`
          UPDATE show_seats
             SET status = 'HELD', booking_id = ${bookingId}::uuid, hold_expires_at = ${holdUntil},
                 version = version + 1, updated_at = now()
           WHERE show_id = ${input.showId} AND seat_id = ANY(${input.seatIds}) AND status = 'AVAILABLE'`;
        if (held !== input.seatIds.length) throw seatsUnavailable();

        await this.outbox.add(tx, {
          topic: TOPICS.bookingHeld,
          aggregate: 'booking',
          aggregateId: bookingId,
          payload: { bookingId, showId: input.showId, seatIds: input.seatIds, holdExpiresAt: holdUntil.toISOString() },
        });
        await this.audit.record(tx, {
          actor: customer,
          action: 'booking.held',
          entity: 'booking',
          entityId: bookingId,
          payload: { showId: input.showId, seats: input.seatIds.length },
        });
      });
    } catch (error) {
      await this.inventory.releaseHoldKeys(input.showId, input.seatIds, bookingId);
      this.metrics.seatHolds.inc({ result: error instanceof DomainException && error.code === 'SEATS_UNAVAILABLE' ? 'conflict' : 'error' });
      throw error;
    }
    stopTimer();
    this.metrics.seatHolds.inc({ result: 'success' });

    // 3. After commit: cache + live seat maps + expiry timer.
    await this.inventory.publishSeatChange(input.showId, input.seatIds, 'HELD');
    await this.queues
      .queue(QUEUES.bookingExpiry)
      .add(
        'expire',
        { bookingId },
        { jobId: `expire-${bookingId}`, delay: this.holdTtlMs + 1000, attempts: 5, backoff: { type: 'exponential', delay: 2000 } },
      )
      .catch((error: unknown) => this.logger.warn({ err: error, bookingId }, 'Expiry job not scheduled; sweeper will expire it'));

    return this.get(customer, bookingId);
  }

  /** Customer gives up the hold before paying. */
  async release(customer: AuthUser, bookingId: string): Promise<void> {
    const booking = await this.prisma.booking.findFirst({ where: { id: bookingId, userId: customer.id } });
    if (!booking) throw notFound('Booking');
    if (booking.status !== 'PENDING') {
      throw new DomainException('BOOKING_NOT_PENDING', `Booking is ${booking.status}`, HttpStatus.CONFLICT);
    }
    await this.expire(bookingId, 'released');
  }

  /**
   * PENDING → EXPIRED and its HELD seats back to AVAILABLE, in one transaction.
   * Safe to call repeatedly and concurrently with confirmation (only one wins).
   */
  async expire(bookingId: string, reason: 'timeout' | 'released' | 'show_cancelled'): Promise<boolean> {
    const result = await this.prisma.$transaction(async (tx) => {
      const timeGuard = reason === 'timeout' ? Prisma.sql`AND hold_expires_at <= now()` : Prisma.empty;
      const rows = await tx.$queryRaw<Array<{ show_id: string }>>`
        UPDATE bookings SET status = 'EXPIRED', updated_at = now()
         WHERE id = ${bookingId}::uuid AND status = 'PENDING' ${timeGuard}
        RETURNING show_id`;
      if (rows.length === 0) return null;
      const seats = await tx.$queryRaw<Array<{ seat_id: string }>>`
        UPDATE show_seats
           SET status = 'AVAILABLE', booking_id = NULL, hold_expires_at = NULL, version = version + 1, updated_at = now()
         WHERE booking_id = ${bookingId}::uuid AND status = 'HELD'
        RETURNING seat_id`;
      const showId = rows[0]!.show_id;
      const seatIds = seats.map((s) => s.seat_id);
      await this.outbox.add(tx, {
        topic: TOPICS.bookingExpired,
        aggregate: 'booking',
        aggregateId: bookingId,
        payload: { bookingId, showId, seatIds, reason },
      });
      return { showId, seatIds };
    });
    if (!result) return false;
    this.metrics.bookings.inc({ status: 'expired' });
    await this.inventory.releaseHoldKeys(result.showId, result.seatIds, bookingId);
    await this.inventory.publishSeatChange(result.showId, result.seatIds, 'AVAILABLE');
    return true;
  }

  async sweepExpired(): Promise<number> {
    const due = await this.prisma.booking.findMany({
      where: { status: 'PENDING', holdExpiresAt: { lte: new Date() } },
      select: { id: true },
      orderBy: { holdExpiresAt: 'asc' },
      take: 200,
    });
    let expired = 0;
    for (const { id } of due) {
      try {
        expired += Number(await this.expire(id, 'timeout'));
      } catch (error) {
        this.logger.error({ err: error, bookingId: id }, 'Failed to expire booking');
      }
    }
    if (expired > 0) this.logger.log({ expired }, 'Expired stale holds');
    return expired;
  }

  // ── Settlement (called by the payment module inside its transaction) ──

  /** Locks the booking row for payment settlement and returns what settlement needs. */
  async lockForSettlement(tx: Tx, bookingId: string): Promise<{ status: BookingStatus; showId: string }> {
    const [row] = await tx.$queryRaw<Array<{ status: BookingStatus; show_id: string }>>`
      SELECT status, show_id FROM bookings WHERE id = ${bookingId}::uuid FOR UPDATE`;
    if (!row) throw notFound('Booking');
    return { status: row.status, showId: row.show_id };
  }

  /**
   * PENDING booking + captured payment → CONFIRMED, seats BOOKED. The caller
   * holds the booking row lock and has seen it PENDING; the status precondition
   * stays anyway (booking-integrity: every state UPDATE is conditional).
   */
  async confirmInTx(tx: Tx, bookingId: string): Promise<ConfirmResult> {
    const [row] = await tx.$queryRaw<Array<{ show_id: string }>>`
      UPDATE bookings SET status = 'CONFIRMED', confirmed_at = now(), updated_at = now()
       WHERE id = ${bookingId}::uuid AND status = 'PENDING'
      RETURNING show_id`;
    if (!row) throw new Error(`booking ${bookingId} is not PENDING — caller must lock and check it first`);
    return this.bookHeldSeats(tx, bookingId, row.show_id);
  }

  /**
   * Late payment for an EXPIRED booking (caller holds the row lock): re-hold
   * exactly its seats (all or nothing) and confirm. Returns null when any seat
   * has been taken meanwhile.
   */
  async lateConfirmInTx(tx: Tx, bookingId: string): Promise<ConfirmResult | null> {
    const booking = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { holdExpiresAt: true, showId: true } });
    const seats = await tx.$queryRaw<Array<{ id: string; status: string }>>`
      SELECT s.id, s.status FROM show_seats s
        JOIN booking_items bi ON bi.show_seat_id = s.id
       WHERE bi.booking_id = ${bookingId}::uuid
       FOR UPDATE OF s`;
    if (seats.length === 0 || seats.some((s) => s.status !== 'AVAILABLE')) return null;

    await tx.$executeRaw`
      UPDATE show_seats SET status = 'HELD', booking_id = ${bookingId}::uuid, hold_expires_at = ${booking.holdExpiresAt},
             version = version + 1, updated_at = now()
       WHERE id = ANY(${seats.map((s) => s.id)}::uuid[])`;
    await tx.$executeRaw`
      UPDATE bookings SET status = 'CONFIRMED', confirmed_at = now(), updated_at = now()
       WHERE id = ${bookingId}::uuid AND status = 'EXPIRED'`;
    return this.bookHeldSeats(tx, bookingId, booking.showId);
  }

  private async bookHeldSeats(tx: Tx, bookingId: string, showId: string): Promise<ConfirmResult> {
    const seats = await tx.$queryRaw<Array<{ seat_id: string }>>`
      UPDATE show_seats SET status = 'BOOKED', hold_expires_at = NULL, version = version + 1, updated_at = now()
       WHERE booking_id = ${bookingId}::uuid AND status = 'HELD'
      RETURNING seat_id`;
    // A partial result is impossible to commit: the deferred consistency trigger
    // requires every item of a CONFIRMED booking to be BOOKED by it.
    await this.outbox.add(tx, {
      topic: TOPICS.bookingConfirmed,
      aggregate: 'booking',
      aggregateId: bookingId,
      payload: { bookingId, showId, seatIds: seats.map((s) => s.seat_id) },
    });
    return { showId, seatIds: seats.map((s) => s.seat_id) };
  }

  // ── Customer reads ──────────────────────────────────────────────────────

  async list(customer: AuthUser, query: ListBookingsQuery) {
    const where: Prisma.BookingWhereInput = { userId: customer.id, ...(query.status ? { status: query.status } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.booking.findMany({
        where,
        include: BOOKING_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.booking.count({ where }),
    ]);
    const shows = await this.catalog.showSummaries(rows.map((b) => b.showId));
    return pageOf(
      rows.map((b) => this.toDto(b, shows.get(b.showId))),
      total,
      query,
    );
  }

  async get(customer: AuthUser, bookingId: string) {
    const booking = await this.prisma.booking.findFirst({ where: { id: bookingId, userId: customer.id }, include: BOOKING_INCLUDE });
    if (!booking) throw notFound('Booking');
    const shows = await this.catalog.showSummaries([booking.showId]);
    return this.toDto(booking, shows.get(booking.showId));
  }

  async ticket(customer: AuthUser, bookingId: string) {
    const booking = await this.get(customer, bookingId);
    if (booking.status !== 'CONFIRMED') {
      throw new DomainException('BOOKING_NOT_CONFIRMED', 'Tickets are available for confirmed bookings only', HttpStatus.CONFLICT);
    }
    const code = createTicketCode(this.config.get('TICKET_SIGNING_SECRET', { infer: true }), bookingId);
    return {
      ...booking,
      ticketCode: code,
      qrCodeDataUrl: await QRCode.toDataURL(code, { errorCorrectionLevel: 'M', margin: 1, width: 320 }),
    };
  }

  // ── Cancellation ────────────────────────────────────────────────────────

  /** Customer cancellation within policy: seats released, refund = total − fee. */
  async cancel(customer: AuthUser, bookingId: string) {
    const booking = await this.prisma.booking.findFirst({ where: { id: bookingId, userId: customer.id } });
    if (!booking) throw notFound('Booking');
    if (booking.status !== 'CONFIRMED') {
      throw new DomainException('BOOKING_NOT_CANCELLABLE', `A ${booking.status} booking cannot be cancelled`, HttpStatus.CONFLICT);
    }
    if (booking.checkedInAt) {
      throw new DomainException('BOOKING_ALREADY_USED', 'This ticket has already been used at the venue', HttpStatus.CONFLICT);
    }
    const show = await this.catalog.saleableShow(booking.showId);
    const totalMinor = decimalStringToMinor(booking.totalAmount.toFixed(2));
    if (show.status === 'CANCELLED') {
      // The organiser cancelled the show (refunds may still be processing): always a full refund, no cut-off.
      await this.cancelConfirmed(customer, bookingId, totalMinor, 'show_cancelled');
      return this.get(customer, bookingId);
    }
    const cutoffMs = this.config.get('CANCELLATION_CUTOFF_HOURS', { infer: true }) * 3600_000;
    if (show.startsAt.getTime() - Date.now() < cutoffMs) {
      throw new DomainException('CANCELLATION_WINDOW_CLOSED', 'Bookings can no longer be cancelled for this show', HttpStatus.CONFLICT);
    }
    const feePercent = this.config.get('CANCELLATION_FEE_PERCENT', { infer: true });
    const refundMinor = Math.floor((totalMinor * (100 - feePercent)) / 100);

    await this.cancelConfirmed(customer, bookingId, refundMinor, 'customer_cancel');
    return this.get(customer, bookingId);
  }

  /**
   * CONFIRMED → CANCELLED, BOOKED seats → AVAILABLE, refund requested — one transaction.
   */
  private async cancelConfirmed(
    actor: AuthUser | null,
    bookingId: string,
    refundMinor: number,
    reason: 'customer_cancel' | 'show_cancelled',
  ) {
    // A customer can never cancel a ticket that was used at the door — checked inside the UPDATE so a
    // concurrent check-in cannot slip between the pre-check and the cancellation. The organiser may.
    const notUsed = reason === 'customer_cancel' ? Prisma.sql`AND checked_in_at IS NULL` : Prisma.empty;
    const result = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ show_id: string }>>`
        UPDATE bookings SET status = 'CANCELLED', cancelled_at = now(), updated_at = now()
         WHERE id = ${bookingId}::uuid AND status = 'CONFIRMED' ${notUsed}
        RETURNING show_id`;
      if (rows.length === 0) throw new DomainException('BOOKING_NOT_CANCELLABLE', 'Booking is no longer confirmed', HttpStatus.CONFLICT);
      const seats = await tx.$queryRaw<Array<{ seat_id: string }>>`
        UPDATE show_seats SET status = 'AVAILABLE', booking_id = NULL, version = version + 1, updated_at = now()
         WHERE booking_id = ${bookingId}::uuid AND status = 'BOOKED'
        RETURNING seat_id`;
      const payment = await this.refunds.capturedPaymentFor(tx, bookingId);
      if (payment && refundMinor > 0) {
        await this.refunds.request(tx, { paymentId: payment.id, bookingId, amount: minorToDecimalString(refundMinor), reason });
      }
      const showId = rows[0]!.show_id;
      const seatIds = seats.map((s) => s.seat_id);
      await this.outbox.add(tx, {
        topic: TOPICS.bookingCancelled,
        aggregate: 'booking',
        aggregateId: bookingId,
        payload: { bookingId, showId, seatIds, reason, refundAmount: minorToDecimalString(refundMinor) },
      });
      await this.audit.record(tx, {
        actor,
        action: 'booking.cancelled',
        entity: 'booking',
        entityId: bookingId,
        payload: { reason, refundAmount: minorToDecimalString(refundMinor) },
      });
      return { showId, seatIds };
    });
    await this.inventory.publishSeatChange(result.showId, result.seatIds, 'AVAILABLE');
    this.metrics.bookings.inc({ status: 'cancelled' });
  }

  /**
   * Manager cancels a show. The show is marked CANCELLED and its free seats are
   * blocked immediately; refunding every booking runs as a durable background
   * job (retried until done, and re-run by a reconciler), so a timeout or crash
   * can never leave bookings of a cancelled show unrefunded. Safe to call again.
   */
  async cancelShow(manager: AuthUser, showId: string) {
    const show = await this.managerCatalog.markShowCancelled(manager, showId);
    await this.inventory.blockAllAvailable(showId);
    await this.enqueueShowCancellation(showId);
    await this.audit.recordStandalone({ actor: manager, action: 'show.cancelled', entity: 'show', entityId: showId });
    return { show, status: 'CANCELLING' as const };
  }

  private enqueueShowCancellation(showId: string) {
    return (
      this.queues
        .queue(QUEUES.showCancellations)
        // removeOnFail: a job that exhausted its attempts must not block re-enqueueing (BullMQ ignores duplicate jobIds).
        .add(
          'cancel-show',
          { showId },
          {
            jobId: `cancel-show-${showId}`,
            attempts: 10,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: true,
            removeOnFail: true,
          },
        )
    );
  }

  /**
   * Worker: cancels every open booking of a cancelled show (full refunds), then
   * re-blocks its seats. One failing booking never blocks the others: it is
   * skipped for this run and the job fails at the end, so BullMQ retries it (and
   * the reconciler re-enqueues it after the retries are exhausted).
   */
  async processShowCancellation(showId: string) {
    let refunded = 0;
    let released = 0;
    const failed = new Map<string, unknown>();
    for (;;) {
      const batch = await this.prisma.booking.findMany({
        where: { showId, status: { in: ['PENDING', 'CONFIRMED'] }, ...(failed.size ? { id: { notIn: [...failed.keys()] } } : {}) },
        select: { id: true, status: true, totalAmount: true },
        take: 100,
      });
      if (batch.length === 0) break;
      for (const booking of batch) {
        try {
          if (booking.status === 'PENDING') {
            released += Number(await this.expire(booking.id, 'show_cancelled'));
          } else {
            await this.cancelConfirmed(null, booking.id, decimalStringToMinor(booking.totalAmount.toFixed(2)), 'show_cancelled');
            refunded++;
          }
        } catch (error) {
          // A concurrent change (e.g. the customer cancelled) shows up as a DomainException: the next pass re-reads it.
          if (!(error instanceof DomainException)) failed.set(booking.id, error);
        }
      }
    }
    if (failed.size > 0) {
      this.logger.error({ showId, failed: [...failed.keys()], err: [...failed.values()][0] }, 'Show cancellation incomplete; will retry');
      throw new Error(`show ${showId}: ${failed.size} booking(s) could not be cancelled`);
    }
    // Seats released by cancellations went back to AVAILABLE; keep the cancelled show unsellable.
    await this.inventory.blockAllAvailable(showId);
    await this.outbox.addStandalone({
      topic: TOPICS.showCancelled,
      aggregate: 'show',
      aggregateId: showId,
      payload: { showId, refundedBookings: refunded, releasedHolds: released },
    });
    this.logger.log({ showId, refunded, released }, 'Show cancellation processed');
    return { refunded, released };
  }

  /** Scheduler: re-enqueues cancelled shows that still have open bookings (e.g. a payment that settled late). */
  async reconcileCancelledShows(): Promise<number> {
    const cancelled = await this.catalog.recentlyCancelledShowIds();
    if (cancelled.length === 0) return 0;
    const open = await this.prisma.booking.groupBy({
      by: ['showId'],
      where: { showId: { in: cancelled }, status: { in: ['PENDING', 'CONFIRMED'] } },
    });
    for (const { showId } of open) await this.enqueueShowCancellation(showId);
    return open.length;
  }

  // ── Manager reads ───────────────────────────────────────────────────────

  async showBookings(manager: AuthUser, showId: string, query: ShowBookingsQuery) {
    await this.managerCatalog.ownedShow(manager, showId);
    const where: Prisma.BookingWhereInput = { showId, ...(query.status ? { status: query.status } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.booking.findMany({
        where,
        include: { ...BOOKING_INCLUDE, user: { select: { name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.booking.count({ where }),
    ]);
    return pageOf(
      rows.map((b) => ({ ...this.toDto(b, undefined), customer: { name: b.user.name, email: maskEmail(b.user.email) } })),
      total,
      query,
    );
  }

  /**
   * Door scanning: validates a ticket QR code for one of the manager's shows and
   * checks it in. A ticket admits once — later scans of the same code (e.g. a
   * shared screenshot) report ALREADY_CHECKED_IN.
   */
  async verifyTicket(manager: AuthUser, code: string) {
    const bookingId = verifyTicketCode(this.config.get('TICKET_SIGNING_SECRET', { infer: true }), code.trim());
    if (!bookingId) throw new DomainException('TICKET_INVALID', 'Ticket code is not valid', HttpStatus.BAD_REQUEST);
    const existing = await this.prisma.booking.findUnique({ where: { id: bookingId }, select: { showId: true } });
    if (!existing) throw new DomainException('TICKET_INVALID', 'Ticket code is not valid', HttpStatus.BAD_REQUEST);
    const show = await this.managerCatalog.ownedShow(manager, existing.showId); // 404 for other managers' tickets
    if (show.status === 'CANCELLED') {
      const booking = await this.prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, include: BOOKING_INCLUDE });
      const summaries = await this.catalog.showSummaries([booking.showId]);
      return {
        valid: false,
        reason: 'SHOW_CANCELLED' as const,
        checkedInAt: booking.checkedInAt?.toISOString() ?? null,
        booking: this.toDto(booking, summaries.get(booking.showId)),
      };
    }

    const { count } = await this.prisma.booking.updateMany({
      where: { id: bookingId, status: 'CONFIRMED', checkedInAt: null },
      data: { checkedInAt: new Date() },
    });
    const booking = await this.prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, include: BOOKING_INCLUDE });
    const shows = await this.catalog.showSummaries([booking.showId]);
    const reason = count === 1 ? null : booking.status !== 'CONFIRMED' ? ('NOT_CONFIRMED' as const) : ('ALREADY_CHECKED_IN' as const);
    if (count === 1) {
      await this.audit.recordStandalone({ actor: manager, action: 'ticket.checked_in', entity: 'booking', entityId: bookingId });
    }
    return {
      valid: count === 1,
      reason,
      checkedInAt: booking.checkedInAt?.toISOString() ?? null,
      booking: this.toDto(booking, shows.get(booking.showId)),
    };
  }

  /** Internal (notifications): booking with the customer's contact details and ticket code. */
  async notificationContext(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { ...BOOKING_INCLUDE, user: { select: { name: true, email: true, phone: true } } },
    });
    if (!booking) return null;
    const shows = await this.catalog.showSummaries([booking.showId]);
    return {
      customer: booking.user,
      booking: this.toDto(booking, shows.get(booking.showId)),
      ticketCode:
        booking.status === 'CONFIRMED' ? createTicketCode(this.config.get('TICKET_SIGNING_SECRET', { infer: true }), bookingId) : null,
    };
  }

  // ── Mapping ─────────────────────────────────────────────────────────────

  private toDto(
    b: BookingWithItems,
    show: Awaited<ReturnType<PublicCatalogService['showSummaries']>> extends Map<string, infer S> ? S | undefined : never,
  ) {
    const latestPayment = b.payments[0];
    return {
      id: b.id,
      bookingRef: b.bookingRef,
      status: b.status as BookingStatus,
      showId: b.showId,
      eventId: b.eventId,
      show: show ?? null,
      seats: b.items
        .map((i) => ({
          seatId: i.showSeat.seatId,
          section: i.showSeat.section,
          row: i.showSeat.rowLabel,
          number: i.showSeat.seatNumber,
          price: i.price.toFixed(2),
        }))
        .sort((x, y) => x.seatId.localeCompare(y.seatId, 'en', { numeric: true })),
      totalAmount: b.totalAmount.toFixed(2),
      currency: b.currency,
      holdExpiresAt: b.status === 'PENDING' ? b.holdExpiresAt.toISOString() : null,
      paymentStatus: latestPayment?.status ?? null,
      createdAt: b.createdAt.toISOString(),
      confirmedAt: b.confirmedAt?.toISOString() ?? null,
      cancelledAt: b.cancelledAt?.toISOString() ?? null,
    };
  }
}

/** j***@example.com — managers see enough to help at the door, not full contact data. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}
