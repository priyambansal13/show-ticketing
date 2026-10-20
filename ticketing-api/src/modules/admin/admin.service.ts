import { HttpStatus, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth/auth.decorators.js';
import { DomainException, notFound } from '../../common/errors/domain.exception.js';
import { pageOf, PaginationSchema } from '../../common/validation/zod.js';
import type { UserStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { TokenService } from '../auth/token.service.js';

export const ListManagersQuerySchema = PaginationSchema.extend({
  status: z.enum(['ACTIVE', 'PENDING_VERIFICATION', 'SUSPENDED']).optional(),
});
export type ListManagersQuery = z.infer<typeof ListManagersQuerySchema>;

export const ManagerSummarySchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string(),
  status: z.enum(['ACTIVE', 'PENDING_VERIFICATION', 'SUSPENDED']),
  orgName: z.string().nullable(),
  verifiedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

const MANAGER_SELECT = {
  id: true,
  email: true,
  name: true,
  status: true,
  createdAt: true,
  managerProfile: { select: { orgName: true, verifiedAt: true } },
} as const;

type ManagerRow = {
  id: string;
  email: string;
  name: string;
  status: UserStatus;
  createdAt: Date;
  managerProfile: { orgName: string; verifiedAt: Date | null } | null;
};

const toSummary = (m: ManagerRow) => ({
  id: m.id,
  email: m.email,
  name: m.name,
  status: m.status,
  orgName: m.managerProfile?.orgName ?? null,
  verifiedAt: m.managerProfile?.verifiedAt?.toISOString() ?? null,
  createdAt: m.createdAt.toISOString(),
});

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  async listManagers(query: ListManagersQuery) {
    const where = { role: 'MANAGER' as const, ...(query.status ? { status: query.status } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: MANAGER_SELECT,
        orderBy: { createdAt: 'asc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.user.count({ where }),
    ]);
    return pageOf(rows.map(toSummary), total, query);
  }

  /** PENDING_VERIFICATION or SUSPENDED → ACTIVE. */
  async approveManager(admin: AuthUser, managerId: string) {
    return this.prisma.$transaction(async (tx) => {
      const manager = await tx.user.findFirst({ where: { id: managerId, role: 'MANAGER' }, select: MANAGER_SELECT });
      if (!manager) throw notFound('Manager');
      if (manager.status === 'ACTIVE') {
        throw new DomainException('MANAGER_ALREADY_ACTIVE', 'Manager is already active', HttpStatus.CONFLICT);
      }
      const updated = await tx.user.update({
        where: { id: managerId },
        data: {
          status: 'ACTIVE',
          managerProfile: { update: { verifiedAt: new Date(), verifiedById: admin.id } },
        },
        select: MANAGER_SELECT,
      });
      await this.audit.record(tx, {
        actor: admin,
        action: 'manager.approved',
        entity: 'user',
        entityId: managerId,
        payload: { from: manager.status },
      });
      return toSummary(updated);
    });
  }

  /** Suspends the manager and ends all their sessions immediately (refresh tokens revoked). */
  async suspendManager(admin: AuthUser, managerId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const manager = await tx.user.findFirst({ where: { id: managerId, role: 'MANAGER' }, select: { status: true } });
      if (!manager) throw notFound('Manager');
      if (manager.status === 'SUSPENDED') {
        throw new DomainException('MANAGER_ALREADY_SUSPENDED', 'Manager is already suspended', HttpStatus.CONFLICT);
      }
      const updated = await tx.user.update({ where: { id: managerId }, data: { status: 'SUSPENDED' }, select: MANAGER_SELECT });
      await this.tokens.revokeAllForUser(managerId, tx);
      await this.audit.record(tx, {
        actor: admin,
        action: 'manager.suspended',
        entity: 'user',
        entityId: managerId,
        payload: { from: manager.status },
      });
      return toSummary(updated);
    });
    // Effective immediately, not when the current access token expires.
    await this.tokens.revokeAccessTokens(managerId);
    return result;
  }
}
