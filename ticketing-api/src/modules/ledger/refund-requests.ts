import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { OutboxService, TOPICS } from '../../infra/outbox/outbox.service.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

export type RefundReason = 'customer_cancel' | 'show_cancelled' | 'late_payment_seats_taken' | 'duplicate_payment' | 'booking_not_payable';

/** Refunds that give back revenue (as opposed to money that was never revenue: duplicates, late payments). */
export const REVENUE_REFUND_REASONS: RefundReason[] = ['customer_cancel', 'show_cancelled'];

export interface RefundRequest {
  paymentId: string;
  bookingId: string;
  /** numeric(10,2) as an exact decimal string */
  amount: string;
  reason: RefundReason;
}

type Tx = Pick<Prisma.TransactionClient, 'refund' | 'outboxEvent'>;

/** Short codes keep `rf:{paymentId}:{code}` within the 64-char idempotency_key column. */
const REASON_CODE: Record<RefundReason, string> = {
  customer_cancel: 'cc',
  show_cancelled: 'sc',
  late_payment_seats_taken: 'lp',
  duplicate_payment: 'dp',
  booking_not_payable: 'np',
};

/**
 * The payment ledger's write side for refunds, shared by the booking module
 * (cancellations) and the payment module (settlement). Refund rows are recorded
 * inside the caller's transaction with a deterministic idempotency key per
 * (payment, reason), so concurrent cancel + auto-refund collapse to one row; the
 * DB trigger rejects refunds beyond the captured amount. Payout happens later
 * (PaymentService refund scanner).
 */
@Injectable()
export class RefundRequests {
  constructor(
    private readonly outbox: OutboxService,
    private readonly prisma: PrismaService,
  ) {}

  async request(tx: Tx, input: RefundRequest): Promise<string> {
    const idempotencyKey = `rf:${input.paymentId}:${REASON_CODE[input.reason]}`;
    const existing = await tx.refund.findUnique({ where: { idempotencyKey } });
    if (existing) return existing.id;
    const refund = await tx.refund.create({
      data: { paymentId: input.paymentId, amount: input.amount, reason: input.reason, idempotencyKey, status: 'PENDING' },
    });
    await this.outbox.add(tx, {
      topic: TOPICS.refundRequested,
      aggregate: 'refund',
      aggregateId: refund.id,
      payload: { refundId: refund.id, paymentId: input.paymentId, bookingId: input.bookingId, amount: input.amount, reason: input.reason },
    });
    return refund.id;
  }

  /** The booking's settling payment, if any. */
  capturedPaymentFor(tx: Pick<Prisma.TransactionClient, 'payment'>, bookingId: string) {
    return tx.payment.findFirst({ where: { bookingId, status: 'CAPTURED' }, select: { id: true } });
  }

  /** Non-failed revenue refunds per show (reports). */
  async revenueRefundsByShow(showIds: string[]): Promise<Map<string, Prisma.Decimal>> {
    const rows = await this.prisma.$queryRaw<Array<{ show_id: string; refunded: string }>>`
      SELECT b.show_id, sum(r.amount)::text AS refunded
        FROM refunds r
        JOIN payments p ON p.id = r.payment_id
        JOIN bookings b ON b.id = p.booking_id
       WHERE b.show_id = ANY(${showIds}) AND r.status <> 'FAILED' AND r.reason = ANY(${REVENUE_REFUND_REASONS})
       GROUP BY b.show_id`;
    return new Map(rows.map((r) => [r.show_id, new Prisma.Decimal(r.refunded)]));
  }
}
