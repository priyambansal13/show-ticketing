import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { QueueService } from './queue.service.js';

const QUEUE = 'maintenance';
const DAY_MS = 86_400_000;

/**
 * Daily housekeeping so bookkeeping tables don't grow without bound:
 * expired idempotency keys, relayed outbox rows, webhook dedupe rows and dead
 * refresh tokens. Retention windows comfortably exceed every retry window.
 */
@Injectable()
export class MaintenanceService implements OnModuleInit {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.queues.worker(QUEUE, () => this.purge(), { concurrency: 1 });
    if (this.queues.workersEnabled) {
      await this.queues.queue(QUEUE).upsertJobScheduler('daily-purge', { pattern: '30 3 * * *', tz: 'Asia/Kolkata' }, { name: 'purge' });
    }
  }

  async purge(now = new Date()) {
    const before = (days: number) => new Date(now.getTime() - days * DAY_MS);
    const [idempotency, outbox, webhooks, tokens] = await Promise.all([
      this.prisma.idempotencyKey.deleteMany({ where: { expiresAt: { lt: now } } }),
      this.prisma.outboxEvent.deleteMany({ where: { status: 'SENT', sentAt: { lt: before(7) } } }),
      this.prisma.processedWebhook.deleteMany({ where: { receivedAt: { lt: before(30) } } }),
      this.prisma.refreshToken.deleteMany({ where: { OR: [{ expiresAt: { lt: before(1) } }, { revokedAt: { lt: before(30) } }] } }),
    ]);
    const result = { idempotencyKeys: idempotency.count, outbox: outbox.count, webhooks: webhooks.count, refreshTokens: tokens.count };
    this.logger.log(result, 'Housekeeping done');
    return result;
  }
}
