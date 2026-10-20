import { BeforeApplicationShutdown, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { KafkaService } from '../kafka/kafka.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const BATCH = 200;
/** Longer than the producer's worst-case retry time (kafka.service.ts), so a slow send is not re-claimed. */
const LEASE_SECONDS = 90;
const MAX_ATTEMPTS = 10;
/** When the broker itself is unreachable, rows are re-tried after this pause without spending attempts. */
const OUTAGE_BACKOFF_SECONDS = 15;
const IDLE_DELAY_MS = 500;
const ERROR_DELAY_MS = 2000;

/** kafkajs marks errors it would retry (connection loss, leader election) as `retriable`. */
const isRetriable = (error: unknown) => (error as { retriable?: boolean } | null)?.retriable !== false;

interface OutboxRow {
  id: bigint;
  topic: string;
  aggregate_id: string;
  payload: unknown;
  headers: Record<string, string> | null;
  attempts: number;
}

/**
 * Publishes committed outbox rows to Kafka.
 *
 * - Rows are claimed with a short lease (UPDATE … FOR UPDATE SKIP LOCKED, auto-commit),
 *   so several instances relay concurrently and the Kafka call happens outside any
 *   database transaction. A crashed relay's lease simply expires.
 * - Message key = aggregate id, so events of one booking stay in one partition.
 * - If a batch fails, rows are retried one by one. Only *row-specific* failures
 *   count as attempts (other rows went through, or Kafka rejected the row as
 *   non-retriable); such a row backs off and is parked as FAILED after
 *   MAX_ATTEMPTS (visible via `outbox_events{status="FAILED"}`) instead of
 *   blocking everything behind it. A broker outage spends no attempts — rows
 *   just wait and go out when Kafka is back. Delivery is at-least-once;
 *   consumers dedupe on the outbox id header.
 */
@Injectable()
export class OutboxRelayService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(OutboxRelayService.name);
  private running = false;
  private loop?: Promise<void>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly kafka: KafkaService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.kafka.enabled) return;
    this.running = true;
    this.loop = this.run();
  }

  /** Stop before Kafka and PostgreSQL connections close. */
  async beforeApplicationShutdown(): Promise<void> {
    this.running = false;
    await this.loop;
  }

  private async run(): Promise<void> {
    while (this.running) {
      let delay = IDLE_DELAY_MS;
      try {
        if ((await this.relayBatch()) === BATCH) delay = 0;
      } catch (error) {
        this.logger.error({ err: error }, 'Outbox relay batch failed');
        delay = ERROR_DELAY_MS;
      }
      if (delay > 0 && this.running) await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  /** Claims, sends and settles one batch; returns the number of rows sent. */
  async relayBatch(): Promise<number> {
    const rows = await this.prisma.$queryRaw<OutboxRow[]>`
      UPDATE outbox SET claimed_until = now() + make_interval(secs => ${LEASE_SECONDS})
       WHERE id IN (
         SELECT id FROM outbox
          WHERE status = 'PENDING' AND (claimed_until IS NULL OR claimed_until < now())
          ORDER BY id LIMIT ${BATCH}
          FOR UPDATE SKIP LOCKED)
      RETURNING id, topic, aggregate_id, payload, headers, attempts`;
    if (rows.length === 0) return 0;
    rows.sort((a, b) => (a.id < b.id ? -1 : 1));

    try {
      await this.send(rows);
      await this.markSent(rows.map((r) => r.id));
      return rows.length;
    } catch (batchError) {
      this.logger.warn({ err: batchError, rows: rows.length }, 'Outbox batch failed; retrying rows individually');
    }

    let sent = 0;
    const failures: Array<{ row: OutboxRow; error: unknown }> = [];
    for (const row of rows) {
      try {
        await this.send([row]);
        await this.markSent([row.id]);
        sent++;
      } catch (error) {
        failures.push({ row, error });
        // Nothing has gone out and Kafka itself looks unreachable: stop probing row by row.
        if (sent === 0 && isRetriable(error)) break;
      }
    }
    const brokerDown = sent === 0 && failures.every(({ error }) => isRetriable(error));
    if (brokerDown) {
      await this.prisma.$executeRaw`
        UPDATE outbox SET claimed_until = now() + make_interval(secs => ${OUTAGE_BACKOFF_SECONDS}), last_error = ${String(failures[0]?.error).slice(0, 500)}
         WHERE id = ANY(${rows.map((r) => r.id)}::bigint[])`;
      throw new Error('Kafka unavailable; outbox relay paused');
    }
    for (const { row, error } of failures) await this.recordFailure(row, error);
    return sent;
  }

  private async send(rows: OutboxRow[]): Promise<void> {
    const byTopic = new Map<string, OutboxRow[]>();
    for (const row of rows) byTopic.set(row.topic, [...(byTopic.get(row.topic) ?? []), row]);
    for (const [topic, batch] of byTopic) {
      await this.kafka.send(
        topic,
        batch.map((row) => ({
          key: row.aggregate_id,
          value: JSON.stringify(row.payload),
          headers: { outboxId: row.id.toString(), ...row.headers },
        })),
      );
    }
  }

  private markSent(ids: bigint[]) {
    return this.prisma.$executeRaw`
      UPDATE outbox SET status = 'SENT', sent_at = now(), claimed_until = NULL WHERE id = ANY(${ids}::bigint[])`;
  }

  /** A failure attributable to this row: spends one attempt. */
  private async recordFailure(row: OutboxRow, error: unknown): Promise<void> {
    const message = String(error).slice(0, 500);
    const attempts = row.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await this.prisma
        .$executeRaw`UPDATE outbox SET status = 'FAILED', attempts = ${attempts}, last_error = ${message}, claimed_until = NULL WHERE id = ${row.id}`;
      this.logger.error(
        { outboxId: row.id.toString(), topic: row.topic, attempts },
        'Outbox event parked as FAILED — manual replay required',
      );
      return;
    }
    // Exponential back-off via the lease: 2, 4, 8 … seconds (capped at 5 minutes).
    const backoff = Math.min(2 ** attempts, 300);
    await this.prisma.$executeRaw`
      UPDATE outbox SET attempts = ${attempts}, last_error = ${message}, claimed_until = now() + make_interval(secs => ${backoff}) WHERE id = ${row.id}`;
  }
}
