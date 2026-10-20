import { HttpStatus, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import type { AuthUser } from '../../common/auth/auth.decorators.js';
import { DomainException, notFound } from '../../common/errors/domain.exception.js';
import { decimalStringToMinor } from '../../common/money.js';
import { Prisma } from '../../generated/prisma/client.js';
import { MetricsService } from '../../infra/metrics/metrics.service.js';
import { OutboxService, TOPICS } from '../../infra/outbox/outbox.service.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { QUEUES, QueueService } from '../../infra/queue/queue.service.js';
import { REDIS } from '../../infra/redis/redis.module.js';
import { AuditService } from '../audit/audit.service.js';
import { BookingService, type ConfirmResult } from '../booking/booking.service.js';
import { PublicCatalogService } from '../events/public-catalog.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { RefundRequests, type RefundReason } from '../ledger/refund-requests.js';
import type { CheckoutConfirmation, PaymentProvider } from './providers/payment-provider.js';
import { PAYMENT_PROVIDER } from './providers/payment-provider.js';

const toMinor = (amount: Prisma.Decimal) => decimalStringToMinor(amount.toFixed(2));
const SETTLED = new Set(['CAPTURED', 'CAPTURED_DUPLICATE', 'REFUNDED']);

/** Refund payout retry policy (per refund, tracked in Redis). */
const REFUND_LOCK_MS = 120_000;
const REFUND_MAX_FAILURES = 8;
const REFUND_BACKOFF_BASE_S = 10;
/** Submitted refunds still pending at the provider are re-checked after this long. */
const REFUND_RECONCILE_AFTER_MS = 10 * 60_000;

export type SettlementOutcome =
  | { kind: 'confirmed'; bookingId: string; confirm: ConfirmResult }
  | {
      kind: 'already_settled' | 'duplicate_refunded' | 'refunded_seats_unavailable' | 'refunded_not_payable' | 'amount_mismatch';
      bookingId: string;
    };

interface CaptureInput {
  orderId: string;
  providerPaymentId: string;
  amountMinor: number;
  currency: string;
  source: 'checkout' | 'webhook';
}

/**
 * Payments: order creation, capture settlement (normal / late / duplicate /
 * cancelled show), provider webhooks and refund payouts. The provider's webhook
 * is the source of truth; the checkout callback only settles sooner.
 * Settlement is idempotent; refund payouts are serialized per refund.
 */
@Injectable()
export class PaymentService implements OnModuleInit {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_PROVIDER) readonly provider: PaymentProvider,
    private readonly bookings: BookingService,
    private readonly catalog: PublicCatalogService,
    private readonly refunds: RefundRequests,
    private readonly inventory: InventoryService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly queues: QueueService,
    private readonly metrics: MetricsService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async onModuleInit(): Promise<void> {
    // Scans run one at a time per instance; a per-refund Redis lock serializes across instances.
    this.queues.worker(
      QUEUES.refunds,
      async () => {
        await this.processPendingRefunds();
        await this.reconcileSubmittedRefunds();
      },
      { concurrency: 1 },
    );
    if (this.queues.workersEnabled) {
      await this.queues.queue(QUEUES.refunds).upsertJobScheduler('refund-scanner', { every: 10_000 }, { name: 'scan' });
    }
  }

  // ── Customer flow ───────────────────────────────────────────────────────

  async initiate(customer: AuthUser, bookingId: string) {
    const booking = await this.prisma.booking.findFirst({ where: { id: bookingId, userId: customer.id } });
    if (!booking) throw notFound('Booking');
    const payable =
      booking.status === 'PENDING' && booking.holdExpiresAt > new Date() && (await this.catalog.saleableShow(booking.showId)).onSale;
    if (!payable) {
      throw new DomainException(
        'BOOKING_NOT_PAYABLE',
        'This booking can no longer be paid — hold expired, show unavailable or already settled',
        HttpStatus.CONFLICT,
      );
    }

    const payment = (await this.openPayment(bookingId)) ?? (await this.createOrder(booking));
    return {
      paymentId: payment.id,
      provider: this.provider.name,
      publicKey: this.provider.publicKey,
      orderId: payment.providerOrderId,
      amount: payment.amount.toFixed(2),
      amountMinor: toMinor(payment.amount),
      currency: payment.currency,
      bookingRef: booking.bookingRef,
      holdExpiresAt: booking.holdExpiresAt.toISOString(),
    };
  }

  private openPayment(bookingId: string) {
    return this.prisma.payment.findFirst({
      where: { bookingId, status: 'CREATED', providerOrderId: { not: null } },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async createOrder(booking: { id: string; bookingRef: string; totalAmount: Prisma.Decimal; currency: string }) {
    const attempt = (await this.prisma.payment.count({ where: { bookingId: booking.id } })) + 1;
    const idempotencyKey = `${booking.id}:${attempt}`;
    let payment;
    try {
      payment = await this.prisma.payment.create({
        data: {
          bookingId: booking.id,
          provider: this.provider.name,
          amount: booking.totalAmount,
          currency: booking.currency,
          idempotencyKey,
          attempts: attempt,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // A concurrent initiate created this attempt first.
        throw new DomainException('PAYMENT_IN_PROGRESS', 'A payment is being started for this booking, retry shortly', HttpStatus.CONFLICT);
      }
      throw error;
    }
    try {
      const { orderId } = await this.provider.createOrder({
        amountMinor: toMinor(booking.totalAmount),
        currency: booking.currency,
        receipt: booking.bookingRef,
        idempotencyKey,
      });
      return await this.prisma.payment.update({ where: { id: payment.id }, data: { providerOrderId: orderId } });
    } catch (error) {
      this.logger.error({ err: error, bookingId: booking.id }, 'Payment provider order creation failed');
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED' } });
      throw new DomainException('PAYMENT_PROVIDER_UNAVAILABLE', 'Payment could not be started, please retry', HttpStatus.BAD_GATEWAY);
    }
  }

  /** Browser checkout callback: verify signature, confirm capture with the provider, settle. */
  async verifyCheckout(customer: AuthUser, confirmation: CheckoutConfirmation) {
    const payment = await this.ownedPaymentByOrder(customer, confirmation.orderId);
    if (!this.provider.verifyCheckout(confirmation)) {
      throw new DomainException('PAYMENT_SIGNATURE_INVALID', 'Payment confirmation could not be verified', HttpStatus.BAD_REQUEST);
    }
    const remote = await this.provider.fetchPayment(confirmation.paymentId);
    if (remote.orderId !== confirmation.orderId || !remote.captured) {
      // Authorized but not captured yet — the provider webhook will settle it.
      return { outcome: 'pending_capture' as const, booking: await this.bookings.get(customer, payment.bookingId) };
    }
    const outcome = await this.settleCapture({
      orderId: confirmation.orderId,
      providerPaymentId: confirmation.paymentId,
      amountMinor: remote.amountMinor,
      currency: remote.currency,
      source: 'checkout',
    });
    return { outcome: outcome.kind, booking: await this.bookings.get(customer, payment.bookingId) };
  }

  private async ownedPaymentByOrder(customer: AuthUser, orderId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { providerOrderId: orderId },
      include: { booking: { select: { userId: true } } },
    });
    if (!payment || payment.booking.userId !== customer.id) throw notFound('Payment');
    return payment;
  }

  // ── Webhooks ────────────────────────────────────────────────────────────

  async handleWebhook(providerName: string, rawBody: Buffer | undefined, headers: IncomingHttpHeaders) {
    if (providerName !== this.provider.name || !rawBody) throw notFound('Webhook');
    if (!this.provider.verifyWebhook(rawBody, headers)) {
      throw new DomainException('WEBHOOK_SIGNATURE_INVALID', 'Invalid webhook signature', HttpStatus.UNAUTHORIZED);
    }
    const event = this.provider.parseWebhook(rawBody, headers);
    if (event.eventId) {
      const seen = await this.prisma.processedWebhook.findUnique({
        where: { provider_providerEventId: { provider: this.provider.name, providerEventId: event.eventId } },
      });
      if (seen) return { received: true, duplicate: true };
    }

    // Handlers are idempotent, so recording the event id *after* success is safe:
    // a crash in between just means the provider's retry is processed again.
    switch (event.kind) {
      case 'payment.captured':
        await this.settleCapture({ ...event, providerPaymentId: event.paymentId, source: 'webhook' });
        break;
      case 'payment.failed':
        await this.markFailed(event.orderId, event.reason);
        break;
      case 'refund.processed':
        await this.markRefund(event.refundId, 'PROCESSED');
        break;
      case 'refund.failed':
        await this.markRefund(event.refundId, 'FAILED');
        break;
      case 'ignored':
        break;
    }
    if (event.eventId) {
      await this.prisma.processedWebhook.createMany({
        data: [{ provider: this.provider.name, providerEventId: event.eventId }],
        skipDuplicates: true,
      });
    }
    return { received: true, duplicate: false };
  }

  // ── Settlement ──────────────────────────────────────────────────────────

  async settleCapture(input: CaptureInput): Promise<SettlementOutcome> {
    // Read outside the transaction (MongoDB): may this booking's show still be sold?
    // A show cancelled after this check is caught by the show-cancellation reconciler.
    const target = await this.prisma.payment.findUnique({
      where: { providerOrderId: input.orderId },
      select: { booking: { select: { showId: true } } },
    });
    if (!target) throw notFound('Payment');
    const show = await this.catalog.saleableShow(target.booking.showId);
    const showPayable = show.status === 'ON_SALE' && show.startsAt > new Date();

    const outcome = await this.prisma.$transaction(async (tx): Promise<SettlementOutcome> => {
      const [payment] = await tx.$queryRaw<
        Array<{
          id: string;
          booking_id: string;
          status: string;
          amount: Prisma.Decimal;
          currency: string;
          provider_payment_id: string | null;
        }>
      >`SELECT id, booking_id, status, amount, currency, provider_payment_id FROM payments WHERE provider_order_id = ${input.orderId} FOR UPDATE`;
      const bookingId = payment!.booking_id;
      const amount = new Prisma.Decimal(payment!.amount);

      if (SETTLED.has(payment!.status)) {
        if (payment!.provider_payment_id === input.providerPaymentId) return { kind: 'already_settled', bookingId };
        // A second payment captured against the same order (e.g. a late-authorized retry).
        await this.recordDuplicateCapture(tx, bookingId, amount, payment!.currency, input.providerPaymentId);
        return { kind: 'duplicate_refunded', bookingId };
      }

      if (toMinor(amount) !== input.amountMinor || payment!.currency !== input.currency) {
        // Cannot be refunded automatically (the amount is not ours to trust): flag for manual review.
        this.logger.error(
          { paymentId: payment!.id, expectedMinor: toMinor(amount), capturedMinor: input.amountMinor },
          'Captured amount mismatch — manual review required',
        );
        await tx.payment.update({
          where: { id: payment!.id },
          data: {
            rawResponse: {
              amountMismatch: { capturedMinor: input.amountMinor, currency: input.currency, providerPaymentId: input.providerPaymentId },
            },
          },
        });
        await this.audit.record(tx, {
          actor: null,
          action: 'payment.amount_mismatch',
          entity: 'payment',
          entityId: payment!.id,
          payload: { bookingId, capturedMinor: input.amountMinor, currency: input.currency },
        });
        this.metrics.paymentAnomalies.inc({ kind: 'amount_mismatch' });
        return { kind: 'amount_mismatch', bookingId };
      }

      const booking = await this.bookings.lockForSettlement(tx, bookingId);
      const refundAll = (reason: RefundReason) =>
        this.refunds.request(tx, { paymentId: payment!.id, bookingId, amount: amount.toFixed(2), reason });

      if (await this.refunds.capturedPaymentFor(tx, bookingId)) {
        await tx.payment.update({
          where: { id: payment!.id },
          data: { status: 'CAPTURED_DUPLICATE', providerPaymentId: input.providerPaymentId },
        });
        await refundAll('duplicate_payment');
        return { kind: 'duplicate_refunded', bookingId };
      }

      await tx.payment.update({ where: { id: payment!.id }, data: { status: 'CAPTURED', providerPaymentId: input.providerPaymentId } });
      await this.outbox.add(tx, {
        topic: TOPICS.paymentCaptured,
        aggregate: 'payment',
        aggregateId: payment!.id,
        payload: { paymentId: payment!.id, bookingId, amount: amount.toFixed(2), source: input.source },
      });
      await this.audit.record(tx, {
        actor: null,
        action: 'payment.captured',
        entity: 'payment',
        entityId: payment!.id,
        payload: { bookingId, source: input.source },
      });

      if (showPayable && booking.status === 'PENDING') {
        return { kind: 'confirmed', bookingId, confirm: await this.bookings.confirmInTx(tx, bookingId) };
      }
      if (showPayable && booking.status === 'EXPIRED') {
        const confirm = await this.bookings.lateConfirmInTx(tx, bookingId);
        if (confirm) return { kind: 'confirmed', bookingId, confirm };
        await refundAll('late_payment_seats_taken');
        return { kind: 'refunded_seats_unavailable', bookingId };
      }
      // Cancelled/finished show, or a booking that can no longer be confirmed: never sell — refund.
      await refundAll('booking_not_payable');
      return { kind: 'refunded_not_payable', bookingId };
    });

    if (outcome.kind === 'confirmed') {
      await this.inventory.releaseHoldKeys(outcome.confirm.showId, outcome.confirm.seatIds, outcome.bookingId);
      await this.inventory.publishSeatChange(outcome.confirm.showId, outcome.confirm.seatIds, 'BOOKED');
      this.metrics.bookings.inc({ status: 'confirmed' });
    } else if (outcome.kind !== 'already_settled' && outcome.kind !== 'amount_mismatch') {
      await this.kickRefunds();
    }
    if (outcome.kind !== 'already_settled') this.metrics.payments.inc({ provider: this.provider.name, outcome: outcome.kind });
    this.logger.log({ bookingId: outcome.bookingId, outcome: outcome.kind, source: input.source }, 'Payment settled');
    return outcome;
  }

  /** Stores an extra capture on an already-settled order as its own payment row and refunds it in full. */
  private async recordDuplicateCapture(
    tx: Prisma.TransactionClient,
    bookingId: string,
    amount: Prisma.Decimal,
    currency: string,
    providerPaymentId: string,
  ) {
    if (await tx.payment.findUnique({ where: { providerPaymentId } })) return; // already recorded
    const attempt = (await tx.payment.count({ where: { bookingId } })) + 1;
    const duplicate = await tx.payment.create({
      data: {
        bookingId,
        provider: this.provider.name,
        amount,
        currency,
        status: 'CAPTURED_DUPLICATE',
        providerPaymentId,
        idempotencyKey: `${bookingId}:${attempt}`,
        attempts: attempt,
      },
    });
    await this.refunds.request(tx, { paymentId: duplicate.id, bookingId, amount: amount.toFixed(2), reason: 'duplicate_payment' });
  }

  /** Only open payments can fail; a late `payment.failed` for a settled payment is ignored. */
  private async markFailed(orderId: string, reason: string) {
    await this.prisma.$transaction(async (tx) => {
      const [payment] = await tx.payment.updateManyAndReturn({
        where: { providerOrderId: orderId, status: { in: ['CREATED', 'AUTHORIZED'] } },
        data: { status: 'FAILED', rawResponse: { failureReason: reason.slice(0, 200) } },
        select: { id: true, bookingId: true },
      });
      if (!payment) return;
      await this.outbox.add(tx, {
        topic: TOPICS.paymentFailed,
        aggregate: 'payment',
        aggregateId: payment.id,
        payload: { paymentId: payment.id, bookingId: payment.bookingId },
      });
      this.metrics.payments.inc({ provider: this.provider.name, outcome: 'failed' });
    });
  }

  // ── Refund payouts ──────────────────────────────────────────────────────

  private async kickRefunds() {
    await this.queues
      .queue(QUEUES.refunds)
      // Fixed jobId: concurrent settlements collapse into one pending kick.
      .add('scan', {}, { jobId: 'refund-scan-kick', removeOnComplete: true, removeOnFail: true })
      .catch((error: unknown) => this.logger.warn({ err: error }, 'Could not enqueue refund scan; scheduler will run it'));
  }

  /** Pays out PENDING refunds not yet submitted, oldest first, skipping those in back-off. */
  async processPendingRefunds(): Promise<number> {
    const pending = await this.prisma.refund.findMany({
      where: { status: 'PENDING', providerRefundId: null },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    let processed = 0;
    for (const { id } of pending) {
      if (processed >= 50) break;
      if (await this.redis.exists(`refund:backoff:${id}`)) continue;
      try {
        processed += Number(await this.processRefund(id));
      } catch (error) {
        await this.recordRefundFailure(id, error);
      }
    }
    return processed;
  }

  /**
   * Pays out one refund. Serialized per refund with a Redis lock, so overlapping
   * scans never submit it twice; the provider call also carries the refund's
   * idempotency key. Returns false when there was nothing to do.
   */
  async processRefund(refundId: string): Promise<boolean> {
    const lockKey = `lock:refund:${refundId}`;
    const lockToken = randomUUID();
    if ((await this.redis.set(lockKey, lockToken, 'PX', REFUND_LOCK_MS, 'NX')) !== 'OK') return false;
    try {
      const refund = await this.prisma.refund.findUnique({ where: { id: refundId }, include: { payment: true } });
      if (refund?.status !== 'PENDING' || refund.providerRefundId) return false;
      if (!refund.payment.providerPaymentId) throw new Error(`refund ${refundId}: payment has no provider payment id`);

      const result = await this.provider.refund({
        providerPaymentId: refund.payment.providerPaymentId,
        amountMinor: toMinor(refund.amount),
        idempotencyKey: refund.idempotencyKey,
      });
      await this.prisma.refund.update({ where: { id: refundId }, data: { providerRefundId: result.refundId } });
      if (result.status === 'processed') await this.markRefund(result.refundId, 'PROCESSED');
      return true;
    } finally {
      // Compare-and-delete: never release a lock that expired and was taken by another instance.
      await this.redis.eval(
        "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0",
        1,
        lockKey,
        lockToken,
      );
    }
  }

  private async recordRefundFailure(refundId: string, error: unknown) {
    const failures = await this.redis.incr(`refund:failures:${refundId}`);
    await this.redis.expire(`refund:failures:${refundId}`, 7 * 86_400);
    if (failures < REFUND_MAX_FAILURES) {
      await this.redis.set(`refund:backoff:${refundId}`, '1', 'EX', REFUND_BACKOFF_BASE_S * 2 ** (failures - 1));
      this.logger.warn({ err: error, refundId, failures }, 'Refund payout failed; will retry with back-off');
      return;
    }
    // Give up automatically; leave a visible trail (audit + metric + error log) for manual handling.
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.refund.updateMany({
        where: { id: refundId, status: 'PENDING', providerRefundId: null },
        data: { status: 'FAILED' },
      });
      if (count === 1) {
        await this.audit.record(tx, {
          actor: null,
          action: 'refund.failed',
          entity: 'refund',
          entityId: refundId,
          payload: { failures, error: String(error).slice(0, 200) },
        });
      }
    });
    this.metrics.refundFailures.inc();
    this.logger.error({ err: error, refundId, failures }, 'Refund payout failed permanently — manual action required');
  }

  /** Submitted refunds the provider has not confirmed for a while: ask the provider. */
  async reconcileSubmittedRefunds(): Promise<number> {
    const stale = await this.prisma.refund.findMany({
      where: { status: 'PENDING', providerRefundId: { not: null }, updatedAt: { lt: new Date(Date.now() - REFUND_RECONCILE_AFTER_MS) } },
      select: { id: true, providerRefundId: true },
      take: 50,
    });
    for (const refund of stale) {
      const providerRefundId = refund.providerRefundId as string;
      try {
        const { status } = await this.provider.fetchRefund(providerRefundId);
        if (status === 'pending') await this.prisma.refund.update({ where: { id: refund.id }, data: { updatedAt: new Date() } });
        else await this.markRefund(providerRefundId, status === 'processed' ? 'PROCESSED' : 'FAILED');
      } catch (error) {
        this.logger.warn({ err: error, refundId: refund.id }, 'Refund reconciliation failed; will retry');
      }
    }
    return stale.length;
  }

  /** PENDING → PROCESSED/FAILED exactly once (conditional update), then side effects. */
  private async markRefund(providerRefundId: string, status: 'PROCESSED' | 'FAILED') {
    await this.prisma.$transaction(async (tx) => {
      const [refund] = await tx.refund.updateManyAndReturn({
        where: { providerRefundId, status: 'PENDING' },
        data: { status },
        include: { payment: { select: { id: true, amount: true, bookingId: true, status: true } } },
      });
      if (!refund) return;
      if (status === 'FAILED') {
        await this.audit.record(tx, {
          actor: null,
          action: 'refund.failed',
          entity: 'refund',
          entityId: refund.id,
          payload: { providerRefundId },
        });
        this.metrics.refundFailures.inc();
        return;
      }
      const processed = await tx.refund.aggregate({ where: { paymentId: refund.paymentId, status: 'PROCESSED' }, _sum: { amount: true } });
      const fullyRefunded = processed._sum.amount?.equals(refund.payment.amount) === true;
      if (fullyRefunded && refund.payment.status !== 'REFUNDED') {
        await tx.payment.update({ where: { id: refund.paymentId }, data: { status: 'REFUNDED' } });
      }
      await this.outbox.add(tx, {
        topic: TOPICS.refundProcessed,
        aggregate: 'refund',
        aggregateId: refund.id,
        payload: {
          refundId: refund.id,
          paymentId: refund.paymentId,
          bookingId: refund.payment.bookingId,
          amount: refund.amount.toFixed(2),
        },
      });
    });
  }

  /** Dev/test only (fake provider): what the browser checkout returns after paying — for the caller's own order. */
  async fakeCheckout(customer: AuthUser, orderId: string): Promise<CheckoutConfirmation> {
    const provider = this.provider as PaymentProvider & { completeCheckout?: (id: string) => CheckoutConfirmation };
    if (provider.name !== 'fake' || !provider.completeCheckout) throw notFound('Route');
    await this.ownedPaymentByOrder(customer, orderId);
    return provider.completeCheckout(orderId);
  }
}
