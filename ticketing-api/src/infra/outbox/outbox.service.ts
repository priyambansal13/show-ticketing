import { Injectable } from '@nestjs/common';
import { currentRequestContext } from '../../common/context/request-context.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Topics produced through the outbox. Keep in sync with docs/IMPLEMENTATION_PLAN.md §4.4. */
export const TOPICS = {
  bookingHeld: 'booking.held',
  bookingConfirmed: 'booking.confirmed',
  bookingExpired: 'booking.expired',
  bookingCancelled: 'booking.cancelled',
  paymentCaptured: 'payment.captured',
  paymentFailed: 'payment.failed',
  refundRequested: 'refund.requested',
  refundProcessed: 'refund.processed',
  showCancelled: 'show.cancelled',
  audit: 'audit.events',
} as const;
export type Topic = (typeof TOPICS)[keyof typeof TOPICS];

export interface OutboxMessage {
  topic: Topic;
  aggregate: string;
  aggregateId: string;
  payload: Prisma.InputJsonObject;
}

type Tx = Pick<Prisma.TransactionClient, 'outboxEvent'>;

/**
 * Writes domain events to the transactional outbox. Always pass the
 * transaction client of the state change — the event and the change commit
 * together or not at all; the relay publishes to Kafka afterwards.
 */
@Injectable()
export class OutboxService {
  constructor(private readonly prisma: PrismaService) {}

  async add(tx: Tx, ...messages: OutboxMessage[]): Promise<void> {
    if (messages.length === 0) return;
    const { requestId } = currentRequestContext();
    await tx.outboxEvent.createMany({
      data: messages.map((m) => ({
        topic: m.topic,
        aggregate: m.aggregate,
        aggregateId: m.aggregateId,
        payload: m.payload,
        headers: requestId ? { requestId } : undefined,
      })),
    });
  }

  /** For events that are not part of a larger state change (still durable). */
  async addStandalone(...messages: OutboxMessage[]): Promise<void> {
    await this.add(this.prisma, ...messages);
  }
}
