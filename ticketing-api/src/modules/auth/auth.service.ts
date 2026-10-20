import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import argon2 from 'argon2';
import { Redis } from 'ioredis';
import { DomainException } from '../../common/errors/domain.exception.js';
import type { Env } from '../../config/env.js';
import { Prisma, type Role, type User } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { REDIS } from '../../infra/redis/redis.module.js';
import { AuditService } from '../audit/audit.service.js';
import { toPublicUser, UsersService } from '../users/users.service.js';
import type { AuthResponse, Login, Portal, RegisterCustomer, RegisterManager } from './dto/auth.dto.js';
import { TokenService, type ClientMeta } from './token.service.js';

export const PORTAL_ROLE: Record<Portal, Role> = { customer: 'CUSTOMER', manager: 'MANAGER', admin: 'ADMIN' };

const ARGON2_OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

/** Per-account lockout (independent of IP, so distributed guessing is bounded too). */
const MAX_FAILED_LOGINS = 10;
const LOCKOUT_SECONDS = 15 * 60;
const failedLoginsKey = (role: Role, email: string) => `auth:failed-logins:${role}:${email}`;

const invalidCredentials = () => new DomainException('INVALID_CREDENTIALS', 'Invalid email or password', HttpStatus.UNAUTHORIZED);

export interface SessionResult {
  response: AuthResponse;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  /** Verified against when the account does not exist, so response time doesn't reveal it. */
  private readonly dummyHash = argon2.hash('timing-equalizer-not-a-password', ARGON2_OPTIONS);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<Env, true>,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async registerCustomer(input: RegisterCustomer, meta: ClientMeta): Promise<SessionResult> {
    const user = await this.createUser({ ...input, role: 'CUSTOMER', status: 'ACTIVE' });
    return this.startSession(user, meta);
  }

  async registerManager(input: RegisterManager, meta: ClientMeta): Promise<SessionResult> {
    const autoApprove = this.config.get('MANAGER_AUTO_APPROVE', { infer: true });
    const user = await this.createUser(
      {
        email: input.email,
        password: input.password,
        name: input.name,
        phone: input.phone,
        role: 'MANAGER',
        status: autoApprove ? 'ACTIVE' : 'PENDING_VERIFICATION',
      },
      { orgName: input.orgName, taxId: input.taxId, contactPhone: input.phone, verifiedAt: autoApprove ? new Date() : null },
    );
    return this.startSession(user, meta);
  }

  async login(portal: Portal, input: Login, meta: ClientMeta): Promise<SessionResult> {
    const role = PORTAL_ROLE[portal];
    const lockKey = failedLoginsKey(role, input.email);
    if (Number(await this.redis.get(lockKey)) >= MAX_FAILED_LOGINS) {
      throw new DomainException(
        'ACCOUNT_TEMPORARILY_LOCKED',
        'Too many failed sign-in attempts, try again later',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const user = await this.users.findByEmailAndRole(input.email, role);
    const valid = await argon2.verify(user?.passwordHash ?? (await this.dummyHash), input.password);
    if (!user || !valid) {
      await this.redis.multi().incr(lockKey).expire(lockKey, LOCKOUT_SECONDS, 'NX').exec();
      await this.audit.recordStandalone({
        actor: null,
        action: 'auth.login_failed',
        entity: 'user',
        entityId: user?.id ?? 'unknown',
        payload: { portal },
      });
      throw invalidCredentials();
    }
    if (user.status === 'SUSPENDED') {
      throw new DomainException('ACCOUNT_SUSPENDED', 'This account is suspended', HttpStatus.FORBIDDEN);
    }
    await this.redis.del(lockKey);
    await this.audit.recordStandalone({ actor: user, action: 'auth.login', entity: 'user', entityId: user.id, payload: { portal } });
    return this.startSession(user, meta);
  }

  async refresh(portal: Portal, rawToken: string | undefined, meta: ClientMeta): Promise<SessionResult> {
    if (!rawToken) {
      throw new DomainException('INVALID_REFRESH_TOKEN', 'Session expired, please sign in again', HttpStatus.UNAUTHORIZED);
    }
    const { user, refreshToken } = await this.tokens.rotate(rawToken, PORTAL_ROLE[portal], meta);
    return { response: await this.buildResponse(user), refreshToken };
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (rawToken) await this.tokens.revokeByRaw(rawToken);
  }

  private async startSession(user: User, meta: ClientMeta): Promise<SessionResult> {
    const refreshToken = await this.tokens.issueRefresh(user.id, meta);
    return { response: await this.buildResponse(user), refreshToken };
  }

  private async buildResponse(user: User): Promise<AuthResponse> {
    return {
      accessToken: await this.tokens.signAccess(user),
      tokenType: 'Bearer',
      expiresIn: this.tokens.accessTtlSeconds,
      user: toPublicUser(user),
    };
  }

  private async createUser(
    input: { email: string; password: string; name: string; phone?: string; role: Role; status: User['status'] },
    managerProfile?: { orgName: string; taxId?: string; contactPhone?: string; verifiedAt: Date | null },
  ): Promise<User> {
    const passwordHash = await argon2.hash(input.password, ARGON2_OPTIONS);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: input.email,
            name: input.name,
            phone: input.phone,
            role: input.role,
            status: input.status,
            passwordHash,
            managerProfile: managerProfile ? { create: managerProfile } : undefined,
          },
        });
        await this.audit.record(tx, {
          actor: user,
          action: 'auth.registered',
          entity: 'user',
          entityId: user.id,
          payload: { role: user.role, status: user.status },
        });
        return user;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new DomainException('EMAIL_TAKEN', 'An account with this email already exists', HttpStatus.CONFLICT);
      }
      throw error;
    }
  }
}
