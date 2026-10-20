/**
 * Boots the real application against the shared e2e infrastructure and offers
 * small helpers for building test data through the public API.
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { inject, vi } from 'vitest';
import { configureApp } from '../../../src/bootstrap.js';
import type { Role } from '../../../src/generated/prisma/enums.js';

export const API = '/api/v1';

export interface TestApp {
  app: INestApplication;
  http: ReturnType<typeof request>;
  url: string;
  get<T>(token: unknown): T;
  close(): Promise<void>;
}

export async function startApp(overrides: Record<string, string> = {}): Promise<TestApp> {
  const infra = inject('infra');
  Object.assign(process.env, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    DATABASE_URL: infra.databaseUrl,
    MONGO_URL: infra.mongoUrl,
    REDIS_URL: infra.redisUrl,
    KAFKA_BROKERS: infra.kafkaBrokers,
    SMTP_HOST: infra.smtpHost,
    SMTP_PORT: String(infra.smtpPort),
    JWT_ACCESS_SECRET: 'e2e-jwt-secret-0123456789abcdefghijklmnopqrstuv',
    TICKET_SIGNING_SECRET: 'e2e-ticket-secret-0123456789abcdefghijklmnopq',
    PAYMENT_PROVIDER: 'fake',
    FAKE_PAYMENT_SECRET: 'e2e-fake-payment-secret',
    CORS_ORIGINS: 'http://localhost:3000',
    ...overrides,
  });
  const { AppModule } = await import('../../../src/app.module.js');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ rawBody: true });
  configureApp(app);
  await app.listen(0);
  const url = await app.getUrl();
  return {
    app,
    http: request(app.getHttpServer()),
    url: url.replace('[::1]', 'localhost'),
    get: <T>(token: unknown) => app.get(token as never) as T,
    close: () => app.close(),
  };
}

export const uniqueEmail = (prefix = 'user') => `${prefix}-${randomUUID().slice(0, 8)}@e2e.test`;
export const idem = () => randomUUID().replace(/-/g, '');
export const PASSWORD = 'Password123!e2e';

/** Creates an account directly (bypassing the register rate limit) and signs in through the API. */
export async function createUser(t: TestApp, role: Role, status: 'ACTIVE' | 'PENDING_VERIFICATION' = 'ACTIVE') {
  const { PrismaService } = await import('../../../src/infra/prisma/prisma.service.js');
  const prisma = t.get<InstanceType<typeof PrismaService>>(PrismaService);
  const email = uniqueEmail(role.toLowerCase());
  const user = await prisma.user.create({
    data: {
      email,
      name: `${role} ${email.slice(0, 12)}`,
      role,
      status,
      passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
      ...(role === 'MANAGER'
        ? { managerProfile: { create: { orgName: 'E2E Org', verifiedAt: status === 'ACTIVE' ? new Date() : null } } }
        : {}),
    },
  });
  const portal = role === 'CUSTOMER' ? 'customer' : role === 'MANAGER' ? 'manager' : 'admin';
  const res = await t.http.post(`${API}/auth/${portal}/login`).send({ email, password: PASSWORD }).expect(200);
  return { id: user.id, email, token: res.body.accessToken as string, auth: { Authorization: `Bearer ${res.body.accessToken as string}` } };
}

const seatRow = (label: string, count: number, y: number) =>
  Array.from({ length: count }, (_, i) => ({ id: `${label}${i + 1}`, number: i + 1, x: i, y }));

/**
 * Manager-side setup through the API: venue → layout (VIP row A ×5, STD row B ×5)
 * → event → show (published, on sale). Returns ids.
 */
export async function createOnSaleShow(
  t: TestApp,
  manager: { auth: Record<string, string> },
  opts: { startsInHours?: number; city?: string } = {},
) {
  const venue = await t.http
    .post(`${API}/manager/venues`)
    .set(manager.auth)
    .send({
      name: 'E2E Hall',
      city: opts.city ?? 'pune',
      address: { line1: 'x', state: 'MH', postalCode: '411001' },
      halls: [{ hallId: 'h1', name: 'Hall 1' }],
    })
    .expect(201);
  await t.http
    .put(`${API}/manager/venues/${venue.body.id}/halls/h1/layout`)
    .set(manager.auth)
    .send({
      sections: [
        { code: 'VIP', name: 'VIP', priceTier: 'VIP', rows: [{ label: 'A', seats: seatRow('A', 5, 0) }] },
        { code: 'STD', name: 'Standard', priceTier: 'STD', rows: [{ label: 'B', seats: seatRow('B', 5, 1) }] },
      ],
    })
    .expect(200);
  const event = await t.http
    .post(`${API}/manager/events`)
    .set(manager.auth)
    .send({ title: `E2E Show ${randomUUID().slice(0, 6)}`, description: 'e2e', category: 'CONCERT', durationMins: 90 })
    .expect(201);
  await t.http.post(`${API}/manager/events/${event.body.id}/publish`).set(manager.auth).expect(200);
  const startsAt = new Date(Date.now() + (opts.startsInHours ?? 72) * 3600_000);
  const show = await t.http
    .post(`${API}/manager/shows`)
    .set(manager.auth)
    .send({
      eventId: event.body.id,
      venueId: venue.body.id,
      hallId: 'h1',
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + 2 * 3600_000).toISOString(),
      salesOpenAt: new Date(Date.now() - 60_000).toISOString(),
      pricing: { VIP: 100000, STD: 40000 },
    })
    .expect(201);
  await t.http.post(`${API}/manager/shows/${show.body.id}/publish`).set(manager.auth).expect(200);
  return { venueId: venue.body.id as string, eventId: event.body.id as string, showId: show.body.id as string };
}

/** Polls until `check` stops throwing (async side effects: Kafka consumers, workers). */
export function eventually<T>(check: () => Promise<T>, timeoutMs = 20_000): Promise<T> {
  // vi.waitFor (not a hand-rolled try/catch): Vitest counts a failed expect() even if it is caught.
  return vi.waitFor(check, { timeout: timeoutMs, interval: 300 });
}

/** All test requests share one IP; clear the limiter buckets between tests (the limiter itself is tested explicitly). */
export async function resetRateLimits(t: TestApp): Promise<void> {
  const { REDIS } = await import('../../../src/infra/redis/redis.module.js');
  const redis = t.get<import('ioredis').Redis>(REDIS);
  const keys = await redis.keys('rl:*');
  if (keys.length > 0) await redis.del(...keys);
}
