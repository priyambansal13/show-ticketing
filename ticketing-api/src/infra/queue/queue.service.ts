import { BeforeApplicationShutdown, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type ConnectionOptions, type Job, type Processor, type WorkerOptions } from 'bullmq';
import type { Env } from '../../config/env.js';
import { MetricsService } from '../metrics/metrics.service.js';

export const QUEUES = {
  bookingExpiry: 'booking-expiry',
  refunds: 'refunds',
  showCancellations: 'show-cancellations',
} as const;

/**
 * BullMQ queues and workers on the shared Redis. Workers start only when
 * WORKERS_ENABLED=true, so API-only instances can still enqueue jobs.
 */
@Injectable()
export class QueueService implements BeforeApplicationShutdown {
  private readonly logger = new Logger(QueueService.name);
  private readonly queues = new Map<string, Queue>();
  private readonly workers: Worker[] = [];
  private readonly connection: ConnectionOptions;
  readonly workersEnabled: boolean;

  constructor(
    config: ConfigService<Env, true>,
    private readonly metrics: MetricsService,
  ) {
    const url = new URL(config.get('REDIS_URL', { infer: true }));
    this.connection = {
      host: url.hostname,
      port: Number(url.port || 6379),
      username: url.username || undefined,
      password: url.password || undefined,
      tls: url.protocol === 'rediss:' ? {} : undefined,
      // Required by BullMQ for blocking connections.
      maxRetriesPerRequest: null,
    };
    this.workersEnabled = config.get('WORKERS_ENABLED', { infer: true });
  }

  queue(name: string): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, {
        connection: this.connection,
        defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000 },
      });
      this.queues.set(name, queue);
    }
    return queue;
  }

  worker<T>(name: string, processor: Processor<T>, options: Partial<WorkerOptions> = {}): Worker<T> | null {
    if (!this.workersEnabled) return null;
    const worker = new Worker<T>(name, processor, { connection: this.connection, concurrency: 5, ...options });
    worker.on('completed', () => this.metrics.jobs.inc({ queue: name, result: 'completed' }));
    worker.on('failed', (job: Job<T> | undefined, error: Error) => {
      this.metrics.jobs.inc({ queue: name, result: 'failed' });
      this.logger.error({ err: error, queue: name, jobId: job?.id, attempts: job?.attemptsMade }, 'Job failed');
    });
    this.workers.push(worker as Worker);
    return worker;
  }

  /** Workers finish their current jobs before PostgreSQL/Redis connections close (onApplicationShutdown). */
  async beforeApplicationShutdown(): Promise<void> {
    await Promise.allSettled(this.workers.map((w) => w.close()));
    await Promise.allSettled([...this.queues.values()].map((q) => q.close()));
  }
}
