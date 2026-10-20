import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import type { Prisma, Role } from '../../generated/prisma/client.js';
import { KafkaService } from '../../infra/kafka/kafka.service.js';
import { TOPICS } from '../../infra/outbox/outbox.service.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

interface AuditMessage {
  actorId: string | null;
  actorRole: Role | null;
  action: string;
  entity: string;
  entityId: string;
  payload: Prisma.InputJsonValue | null;
  ip: string | null;
  requestId: string | null;
  at: string;
}

/** Persists `audit.events` into audit_logs. */
@Injectable()
export class AuditConsumer implements OnApplicationBootstrap {
  constructor(
    private readonly kafka: KafkaService,
    private readonly prisma: PrismaService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.kafka.consume<AuditMessage>('ticketing-audit', [TOPICS.audit], async ({ value }) => {
      await this.prisma.auditLog.create({
        data: {
          actorId: value.actorId,
          actorRole: value.actorRole,
          action: value.action.slice(0, 64),
          entity: value.entity.slice(0, 32),
          entityId: value.entityId.slice(0, 64),
          payload: value.payload ?? undefined,
          ip: value.ip?.slice(0, 45),
          requestId: value.requestId?.slice(0, 64),
          createdAt: new Date(value.at),
        },
      });
    });
  }
}
