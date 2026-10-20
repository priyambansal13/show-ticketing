import { Injectable } from '@nestjs/common';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Prometheus metrics (observability skill). Label values are always bounded —
 * never user, show or booking ids.
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.01, 0.025, 0.05, 0.08, 0.1, 0.2, 0.3, 0.5, 1, 2, 5],
    registers: [this.registry],
  });

  readonly seatHolds = new Counter({
    name: 'seat_hold_attempts_total',
    help: 'Seat hold attempts by result',
    labelNames: ['result'] as const,
    registers: [this.registry],
  });

  readonly seatHoldDuration = new Histogram({
    name: 'seat_hold_duration_seconds',
    help: 'Duration of a seat hold (Redis gate + PostgreSQL transaction)',
    buckets: [0.01, 0.025, 0.05, 0.1, 0.2, 0.5, 1, 2],
    registers: [this.registry],
  });

  readonly bookings = new Counter({
    name: 'bookings_total',
    help: 'Booking state changes',
    labelNames: ['status'] as const,
    registers: [this.registry],
  });

  readonly payments = new Counter({
    name: 'payments_total',
    help: 'Payment settlement outcomes',
    labelNames: ['provider', 'outcome'] as const,
    registers: [this.registry],
  });

  readonly paymentAnomalies = new Counter({
    name: 'payment_anomalies_total',
    help: 'Payments needing manual review',
    labelNames: ['kind'] as const,
    registers: [this.registry],
  });

  readonly refundFailures = new Counter({
    name: 'refund_failures_total',
    help: 'Refunds that failed permanently (manual action required)',
    registers: [this.registry],
  });

  readonly jobs = new Counter({
    name: 'bullmq_jobs_total',
    help: 'Background jobs by queue and result',
    labelNames: ['queue', 'result'] as const,
    registers: [this.registry],
  });

  readonly consumed = new Counter({
    name: 'kafka_messages_consumed_total',
    help: 'Kafka messages handled by consumer group and result',
    labelNames: ['group', 'result'] as const,
    registers: [this.registry],
  });

  readonly wsConnections = new Gauge({
    name: 'ws_connections',
    help: 'Open WebSocket connections',
    labelNames: ['namespace'] as const,
    registers: [this.registry],
  });

  constructor(prisma: PrismaService) {
    collectDefaultMetrics({ register: this.registry });
    // Outbox backlog, read at scrape time: a growing value means the relay or Kafka is stuck.
    new Gauge({
      name: 'outbox_events',
      help: 'Outbox rows by status',
      labelNames: ['status'] as const,
      registers: [this.registry],
      async collect() {
        const rows = await prisma.outboxEvent.groupBy({ by: ['status'], where: { status: { in: ['PENDING', 'FAILED'] } }, _count: true });
        this.reset();
        for (const status of ['PENDING', 'FAILED'] as const) {
          this.set({ status }, rows.find((r) => r.status === status)?._count ?? 0);
        }
      },
    });
  }
}
