import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth.decorators.js';
import { currentRequestContext } from '../../common/context/request-context.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { OutboxService, TOPICS } from '../../infra/outbox/outbox.service.js';

export interface AuditEntry {
  actor: Pick<AuthUser, 'id' | 'role'> | null;
  /** e.g. "auth.login", "manager.approved", "booking.confirmed" */
  action: string;
  entity: string;
  entityId: string;
  /** Allow-listed, non-sensitive fields only (security-standards A09). */
  payload?: Prisma.InputJsonObject;
}

/**
 * Audit trail. Entries travel through the outbox (same transaction as the
 * change they describe) and are persisted by AuditConsumer.
 */
@Injectable()
export class AuditService {
  constructor(private readonly outbox: OutboxService) {}

  async record(tx: Parameters<OutboxService['add']>[0], entry: AuditEntry): Promise<void> {
    await this.outbox.add(tx, this.toMessage(entry));
  }

  async recordStandalone(entry: AuditEntry): Promise<void> {
    await this.outbox.addStandalone(this.toMessage(entry));
  }

  private toMessage(entry: AuditEntry) {
    const { requestId, ip } = currentRequestContext();
    return {
      topic: TOPICS.audit,
      aggregate: entry.entity,
      aggregateId: entry.entityId,
      payload: {
        actorId: entry.actor?.id ?? null,
        actorRole: entry.actor?.role ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        payload: entry.payload ?? null,
        ip: ip ?? null,
        requestId: requestId ?? null,
        at: new Date().toISOString(),
      },
    };
  }
}
