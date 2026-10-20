/**
 * Regression tests for the findings of the booking-integrity, security and
 * code reviews (2026-10-11). Each test names the finding it proves fixed.
 */
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/infra/prisma/prisma.service.js';
import { MaintenanceService } from '../../src/infra/queue/maintenance.service.js';
import { TokenService } from '../../src/modules/auth/token.service.js';
import { BookingService } from '../../src/modules/booking/booking.service.js';
import { PaymentService } from '../../src/modules/payment/payment.service.js';
import { FakePaymentProvider } from '../../src/modules/payment/providers/fake.provider.js';
import { PAYMENT_PROVIDER } from '../../src/modules/payment/providers/payment-provider.js';
import { API, createOnSaleShow, createUser, eventually, idem, PASSWORD, resetRateLimits, startApp, type TestApp } from './support/app.js';

let t: TestApp;
let prisma: PrismaService;
let fake: FakePaymentProvider;
let manager: Awaited<ReturnType<typeof createUser>>;

beforeAll(async () => {
  t = await startApp();
  prisma = t.get<PrismaService>(PrismaService);
  fake = t.get<FakePaymentProvider>(PAYMENT_PROVIDER);
  manager = await createUser(t, 'MANAGER');
});
afterAll(async () => {
  await t?.close();
});
beforeEach(async () => {
  await resetRateLimits(t);
});

async function customer() {
  const id = randomUUID();
  await prisma.user.create({ data: { id, email: `fix-${id.slice(0, 8)}@e2e.test`, name: 'Fix', role: 'CUSTOMER', passwordHash: 'x' } });
  const token = await t.get<TokenService>(TokenService).signAccess({ id, role: 'CUSTOMER', status: 'ACTIVE' });
  return { id, auth: { Authorization: `Bearer ${token}` } };
}
const hold = (auth: Record<string, string>, showId: string, seatIds: string[]) =>
  t.http.post(`${API}/bookings/hold`).set(auth).set('Idempotency-Key', idem()).send({ showId, seatIds });
const initiate = (auth: Record<string, string>, bookingId: string) =>
  t.http.post(`${API}/payments/initiate`).set(auth).set('Idempotency-Key', idem()).send({ bookingId }).expect(201);
const webhook = (body: object) => {
  const raw = JSON.stringify(body);
  return t.http
    .post(`${API}/payments/webhook/fake`)
    .set('Content-Type', 'application/json')
    .set('x-fake-signature', fake.signWebhook(raw))
    .send(raw);
};

describe('booking integrity', () => {
  it('[integrity #1] never confirms a payment that arrives after the show was cancelled — refunds it', async () => {
    const { showId } = await createOnSaleShow(t, manager);
    const c = await customer();
    const held = await hold(c.auth, showId, ['A1']).expect(201);
    const order = await initiate(c.auth, held.body.id as string);
    await t.http.post(`${API}/manager/shows/${showId}/cancel`).set(manager.auth).expect(202);
    await eventually(async () => {
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: held.body.id as string } })).status).toBe('EXPIRED');
    });

    const confirmation = fake.completeCheckout(order.body.orderId as string);
    const res = await t.http.post(`${API}/payments/verify`).set(c.auth).send(confirmation).expect(200);
    expect(res.body).toMatchObject({ outcome: 'refunded_not_payable', booking: { status: 'EXPIRED' } });
    await eventually(async () => {
      expect(await prisma.refund.findFirstOrThrow({ where: { payment: { bookingId: held.body.id as string } } })).toMatchObject({
        status: 'PROCESSED',
      });
    });
    await t.http.post(`${API}/payments/initiate`).set(c.auth).set('Idempotency-Key', idem()).send({ bookingId: held.body.id }).expect(409);
  });

  it('[integrity #1] refuses to start a payment for a cancelled show', async () => {
    const { showId } = await createOnSaleShow(t, manager);
    const c = await customer();
    const held = await hold(c.auth, showId, ['A2']).expect(201);
    await t.http.post(`${API}/manager/shows/${showId}/cancel`).set(manager.auth).expect(202);
    const res = await t.http
      .post(`${API}/payments/initiate`)
      .set(c.auth)
      .set('Idempotency-Key', idem())
      .send({ bookingId: held.body.id })
      .expect(409);
    expect(res.body.error.code).toBe('BOOKING_NOT_PAYABLE');
  });

  it('[integrity #2] show cancellation is resumable — the reconciler finishes leftover bookings', async () => {
    const { showId } = await createOnSaleShow(t, manager);
    const c = await customer();
    const held = await hold(c.auth, showId, ['A3']).expect(201);
    await (async () => {
      const order = await initiate(c.auth, held.body.id as string);
      await t.http
        .post(`${API}/payments/verify`)
        .set(c.auth)
        .send(fake.completeCheckout(order.body.orderId as string))
        .expect(200);
    })();
    // Mark the show cancelled without running the job (as if the process died right after).
    const { ManagerCatalogService } = await import('../../src/modules/events/manager-catalog.service.js');
    const managerUser = { id: manager.id, role: 'MANAGER' as const, status: 'ACTIVE' as const };
    await t.get<InstanceType<typeof ManagerCatalogService>>(ManagerCatalogService).markShowCancelled(managerUser, showId);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: held.body.id as string } })).status).toBe('CONFIRMED');

    expect(await t.get<BookingService>(BookingService).reconcileCancelledShows()).toBeGreaterThanOrEqual(1);
    await eventually(async () => {
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: held.body.id as string } })).status).toBe('CANCELLED');
    }, 30_000);
  });

  it('[integrity #3] concurrent payout attempts submit a refund to the provider only once', async () => {
    const { showId } = await createOnSaleShow(t, manager);
    const c = await customer();
    const held = await hold(c.auth, showId, ['A4']).expect(201);
    const order = await initiate(c.auth, held.body.id as string);
    await t.http
      .post(`${API}/payments/verify`)
      .set(c.auth)
      .send(fake.completeCheckout(order.body.orderId as string))
      .expect(200);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { providerOrderId: order.body.orderId as string } });
    const refund = await prisma.refund.create({
      data: { paymentId: payment.id, amount: '10.00', reason: 'manual', idempotencyKey: `manual-${randomUUID()}` },
    });

    const original = fake.refund.bind(fake);
    const spy = vi.spyOn(fake, 'refund').mockImplementation(async (input) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return original(input);
    });
    try {
      const payments = t.get<PaymentService>(PaymentService);
      await Promise.all([payments.processRefund(refund.id), payments.processRefund(refund.id), payments.processRefund(refund.id)]);
      expect(spy.mock.calls.filter(([input]) => input.idempotencyKey === refund.idempotencyKey)).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('[integrity #5] refunds a second payment captured against an already-settled order', async () => {
    const { showId } = await createOnSaleShow(t, manager);
    const c = await customer();
    const held = await hold(c.auth, showId, ['A5']).expect(201);
    const order = await initiate(c.auth, held.body.id as string);
    await t.http
      .post(`${API}/payments/verify`)
      .set(c.auth)
      .send(fake.completeCheckout(order.body.orderId as string))
      .expect(200);

    const res = await webhook({
      kind: 'payment.captured',
      eventId: `evt_${randomUUID()}`,
      orderId: order.body.orderId,
      paymentId: `pay_second_${randomUUID().slice(0, 6)}`,
      amountMinor: 100000,
      currency: 'INR',
    }).expect(200);
    expect(res.body.duplicate).toBe(false);
    await eventually(async () => {
      const payments = await prisma.payment.findMany({
        where: { bookingId: held.body.id as string },
        include: { refunds: true },
        orderBy: { createdAt: 'asc' },
      });
      expect(payments.map((p) => p.status)).toEqual(['CAPTURED', 'REFUNDED']);
      expect(payments[1]!.refunds).toMatchObject([{ status: 'PROCESSED', reason: 'duplicate_payment' }]);
    });
  });

  it('[integrity #7 / security M2] the active-hold limit cannot be raced', async () => {
    const { showId } = await createOnSaleShow(t, manager);
    const c = await customer();
    const seats = ['A1', 'A2', 'A3', 'A4', 'A5', 'B1', 'B2', 'B3', 'B4', 'B5'];
    const results = await Promise.all(seats.map((seat) => hold(c.auth, showId, [seat])));
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(results.filter((r) => r.status === 409).every((r) => r.body.error.code === 'TOO_MANY_ACTIVE_HOLDS')).toBe(true);
  });

  it('[integrity #8 / code #11] a crashed request does not lock its Idempotency-Key forever', async () => {
    const { showId } = await createOnSaleShow(t, manager);
    const c = await customer();
    const key = idem();
    // A claimed key whose request died 5 minutes ago without storing a response (same body as the retry).
    const body = { showId, seatIds: ['B1'] };
    const { createHash } = await import('node:crypto');
    await prisma.idempotencyKey.create({
      data: {
        userId: c.id,
        route: 'POST /api/v1/bookings/hold',
        key,
        requestHash: createHash('sha256').update(JSON.stringify(body)).digest('hex'),
        createdAt: new Date(Date.now() - 5 * 60_000),
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    await t.http.post(`${API}/bookings/hold`).set(c.auth).set('Idempotency-Key', key).send(body).expect(201);
  });

  it('[integrity #9 / code #8] duplicate-payment refunds do not reduce net revenue', async () => {
    const reporter = await createUser(t, 'MANAGER');
    const { showId } = await createOnSaleShow(t, reporter);
    const c = await customer();
    const held = await hold(c.auth, showId, ['A1']).expect(201);
    const order = await initiate(c.auth, held.body.id as string);
    await t.http
      .post(`${API}/payments/verify`)
      .set(c.auth)
      .send(fake.completeCheckout(order.body.orderId as string))
      .expect(200);
    await webhook({
      kind: 'payment.captured',
      eventId: `evt_${randomUUID()}`,
      orderId: order.body.orderId,
      paymentId: `pay_dup_${randomUUID().slice(0, 6)}`,
      amountMinor: 100000,
      currency: 'INR',
    }).expect(200);
    const report = await t.http.get(`${API}/manager/reports/sales`).set(reporter.auth).expect(200);
    expect(report.body.totals).toMatchObject({ grossRevenue: '1000.00', refunded: '0.00', netRevenue: '1000.00' });
  });
});

describe('security', () => {
  it('[security M1] suspension revokes a manager’s current access token immediately', async () => {
    const suspended = await createUser(t, 'MANAGER');
    await t.http.get(`${API}/manager/venues`).set(suspended.auth).expect(200);
    const admin = await createUser(t, 'ADMIN');
    await t.http.post(`${API}/admin/managers/${suspended.id}/suspend`).set(admin.auth).expect(200);
    await t.http.get(`${API}/manager/venues`).set(suspended.auth).expect(401);
  });

  it('[security L1] locks an account after repeated failed logins, even with the right password', async () => {
    const victim = await createUser(t, 'CUSTOMER');
    for (let i = 0; i < 10; i++) {
      await resetRateLimits(t); // simulate attempts from many IPs: only the per-account lock applies
      await t.http.post(`${API}/auth/customer/login`).send({ email: victim.email, password: 'wrong-password' }).expect(401);
    }
    await resetRateLimits(t);
    const locked = await t.http.post(`${API}/auth/customer/login`).send({ email: victim.email, password: PASSWORD }).expect(429);
    expect(locked.body.error.code).toBe('ACCOUNT_TEMPORARILY_LOCKED');
  });

  it('[security L3] a ticket admits once — replays report ALREADY_CHECKED_IN', async () => {
    const { showId } = await createOnSaleShow(t, manager);
    const c = await customer();
    const held = await hold(c.auth, showId, ['B2']).expect(201);
    const order = await initiate(c.auth, held.body.id as string);
    await t.http
      .post(`${API}/payments/verify`)
      .set(c.auth)
      .send(fake.completeCheckout(order.body.orderId as string))
      .expect(200);
    const { ticketCode } = (
      await t.http
        .get(`${API}/bookings/${held.body.id as string}/ticket`)
        .set(c.auth)
        .expect(200)
    ).body as { ticketCode: string };

    const first = await t.http.post(`${API}/manager/tickets/verify`).set(manager.auth).send({ code: ticketCode }).expect(200);
    expect(first.body).toMatchObject({ valid: true, reason: null, checkedInAt: expect.any(String) });
    const replay = await t.http.post(`${API}/manager/tickets/verify`).set(manager.auth).send({ code: ticketCode }).expect(200);
    expect(replay.body).toMatchObject({ valid: false, reason: 'ALREADY_CHECKED_IN' });
  });

  it('[security L4] the dev checkout helper only completes the caller’s own orders', async () => {
    const { showId } = await createOnSaleShow(t, manager);
    const [owner, other] = [await customer(), await customer()];
    const held = await hold(owner.auth, showId, ['B3']).expect(201);
    const order = await initiate(owner.auth, held.body.id as string);
    await t.http.post(`${API}/payments/fake/complete`).set(other.auth).send({ orderId: order.body.orderId }).expect(404);
    await t.http.post(`${API}/payments/fake/complete`).set(owner.auth).send({ orderId: order.body.orderId }).expect(200);
  });
});

describe('operability', () => {
  it('[code #3] exposes Prometheus metrics', async () => {
    const res = await t.http.get(`${API}/metrics`).expect(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    for (const metric of [
      'http_request_duration_seconds',
      'seat_hold_attempts_total',
      'outbox_events',
      'bullmq_jobs_total',
      'process_cpu_user_seconds_total',
    ]) {
      expect(res.text).toContain(metric);
    }
  });

  it('[code #5 / integrity #10] a poison outbox row is parked as FAILED without blocking later events', async () => {
    const poison = await prisma.outboxEvent.create({
      data: { topic: 'not a valid topic!', aggregate: 'test', aggregateId: 'x', payload: {}, attempts: 9 },
    });
    const healthy = await prisma.outboxEvent.create({
      data: {
        topic: 'audit.events',
        aggregate: 'test',
        aggregateId: 'y',
        payload: {
          action: 'test',
          entity: 'test',
          entityId: 'y',
          actorId: null,
          actorRole: null,
          payload: null,
          ip: null,
          requestId: null,
          at: new Date().toISOString(),
        },
      },
    });
    await eventually(async () => {
      expect((await prisma.outboxEvent.findUniqueOrThrow({ where: { id: poison.id } })).status).toBe('FAILED');
      expect((await prisma.outboxEvent.findUniqueOrThrow({ where: { id: healthy.id } })).status).toBe('SENT');
    }, 30_000);
  });

  it('[code #11] housekeeping purges expired bookkeeping rows', async () => {
    const c = await customer();
    await prisma.idempotencyKey.create({
      data: { userId: c.id, route: 'POST /x', key: idem(), requestHash: 'x'.repeat(64), expiresAt: new Date(Date.now() - 1000) },
    });
    const result = await t.get<MaintenanceService>(MaintenanceService).purge();
    expect(result.idempotencyKeys).toBeGreaterThanOrEqual(1);
    expect(await prisma.idempotencyKey.count({ where: { userId: c.id } })).toBe(0);
  });
});

describe('payment failure handling', () => {
  async function paidBooking(seat: string) {
    const { showId } = await createOnSaleShow(t, manager);
    const c = await customer();
    const held = await hold(c.auth, showId, [seat]).expect(201);
    const order = await initiate(c.auth, held.body.id as string);
    await t.http
      .post(`${API}/payments/verify`)
      .set(c.auth)
      .send(fake.completeCheckout(order.body.orderId as string))
      .expect(200);
    return {
      c,
      bookingId: held.body.id as string,
      payment: await prisma.payment.findUniqueOrThrow({ where: { providerOrderId: order.body.orderId as string } }),
    };
  }

  it('marks the payment FAILED and answers 502 when the provider cannot create an order', async () => {
    const { showId } = await createOnSaleShow(t, manager);
    const c = await customer();
    const held = await hold(c.auth, showId, ['A1']).expect(201);
    const spy = vi.spyOn(fake, 'createOrder').mockRejectedValueOnce(new Error('provider down'));
    try {
      const res = await t.http
        .post(`${API}/payments/initiate`)
        .set(c.auth)
        .set('Idempotency-Key', idem())
        .send({ bookingId: held.body.id })
        .expect(502);
      expect(res.body.error.code).toBe('PAYMENT_PROVIDER_UNAVAILABLE');
    } finally {
      spy.mockRestore();
    }
    expect((await prisma.payment.findFirstOrThrow({ where: { bookingId: held.body.id as string } })).status).toBe('FAILED');
  });

  it('reports PAYMENT_IN_PROGRESS when a concurrent initiate already took the attempt number', async () => {
    const { showId } = await createOnSaleShow(t, manager);
    const c = await customer();
    const held = await hold(c.auth, showId, ['A2']).expect(201);
    const bookingId = held.body.id as string;
    // Attempt 1 is "already being created" by a concurrent request (row exists, counted as attempt 2's slot).
    await prisma.payment.create({
      data: { bookingId, provider: 'fake', amount: '1000.00', currency: 'INR', idempotencyKey: `${bookingId}:1`, status: 'FAILED' },
    });
    await prisma.payment.create({
      data: { bookingId, provider: 'fake', amount: '1000.00', currency: 'INR', idempotencyKey: `${bookingId}:3`, status: 'FAILED' },
    });
    const res = await t.http.post(`${API}/payments/initiate`).set(c.auth).set('Idempotency-Key', idem()).send({ bookingId }).expect(409);
    expect(res.body.error.code).toBe('PAYMENT_IN_PROGRESS');
  });

  it('backs off failing refund payouts and parks them as FAILED after repeated failures', async () => {
    const { payment } = await paidBooking('A3');
    const refund = await prisma.refund.create({
      data: { paymentId: payment.id, amount: '1.00', reason: 'manual', idempotencyKey: `manual-${randomUUID()}` },
    });
    const payments = t.get<PaymentService>(PaymentService);
    const { REDIS } = await import('../../src/infra/redis/redis.module.js');
    const redis = t.get<import('ioredis').Redis>(REDIS);
    const spy = vi.spyOn(fake, 'refund').mockImplementation(async (input) => {
      if (input.idempotencyKey === refund.idempotencyKey) throw new Error('provider rejected');
      return { refundId: `rfnd_${randomUUID().slice(0, 8)}`, status: 'processed' };
    });
    try {
      await payments.processPendingRefunds();
      expect(await redis.exists(`refund:backoff:${refund.id}`)).toBe(1); // backing off after the first failure
      for (let i = 0; i < 10 && (await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } })).status === 'PENDING'; i++) {
        await redis.del(`refund:backoff:${refund.id}`);
        await payments.processPendingRefunds();
      }
    } finally {
      spy.mockRestore();
    }
    expect((await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } })).status).toBe('FAILED');
    await eventually(async () => {
      expect(await prisma.auditLog.count({ where: { entityId: refund.id, action: 'refund.failed' } })).toBeGreaterThanOrEqual(1);
    });
  });

  it('reconciles refunds still pending at the provider (processed, failed, still pending, provider error)', async () => {
    const { payment } = await paidBooking('A4');
    const make = async (status: 'processed' | 'failed' | 'pending' | 'error') => {
      const r = await prisma.refund.create({
        data: {
          paymentId: payment.id,
          amount: '1.00',
          reason: 'manual',
          idempotencyKey: `rec-${status}-${randomUUID()}`,
          providerRefundId: `rfnd_${status}_${randomUUID().slice(0, 6)}`,
        },
      });
      await prisma.$executeRaw`UPDATE refunds SET updated_at = now() - interval '1 hour' WHERE id = ${r.id}::uuid`;
      return r;
    };
    const [processed, failed, pending, broken] = await Promise.all([make('processed'), make('failed'), make('pending'), make('error')]);
    const spy = vi
      .spyOn(fake as unknown as { fetchRefund: (id: string) => Promise<{ status: string }> }, 'fetchRefund')
      .mockImplementation(async (id: string) => {
        if (id === broken.providerRefundId) throw new Error('provider unreachable');
        return { status: id === failed.providerRefundId ? 'failed' : id === pending.providerRefundId ? 'pending' : 'processed' };
      });
    try {
      await t.get<PaymentService>(PaymentService).reconcileSubmittedRefunds();
    } finally {
      spy.mockRestore();
    }
    const status = async (id: string) => (await prisma.refund.findUniqueOrThrow({ where: { id } })).status;
    expect(await status(processed.id)).toBe('PROCESSED');
    expect(await status(failed.id)).toBe('FAILED');
    expect(await status(pending.id)).toBe('PENDING');
    expect((await prisma.refund.findUniqueOrThrow({ where: { id: pending.id } })).updatedAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(await status(broken.id)).toBe('PENDING');
  });
});

describe('follow-up review fixes', () => {
  it('[follow-up #1] one failing booking does not block a show cancellation, and a failed job is re-run', async () => {
    const { showId } = await createOnSaleShow(t, manager);
    const bookings: string[] = [];
    for (const seat of ['A1', 'A2']) {
      const c = await customer();
      const held = await hold(c.auth, showId, [seat]).expect(201);
      const order = await initiate(c.auth, held.body.id as string);
      await t.http
        .post(`${API}/payments/verify`)
        .set(c.auth)
        .send(fake.completeCheckout(order.body.orderId as string))
        .expect(200);
      bookings.push(held.body.id as string);
    }
    const { ManagerCatalogService } = await import('../../src/modules/events/manager-catalog.service.js');
    await t
      .get<InstanceType<typeof ManagerCatalogService>>(ManagerCatalogService)
      .markShowCancelled({ id: manager.id, role: 'MANAGER', status: 'ACTIVE' }, showId);

    const service = t.get<BookingService>(BookingService) as unknown as { cancelConfirmed: (...args: unknown[]) => Promise<void> };
    const original = service.cancelConfirmed.bind(service);
    const spy = vi.spyOn(service, 'cancelConfirmed').mockImplementation(async (...args: unknown[]) => {
      if (args[1] === bookings[0]) throw new Error('unexpected database error');
      return original(...args);
    });
    try {
      await expect(t.get<BookingService>(BookingService).processShowCancellation(showId)).rejects.toThrow(
        /1 booking\(s\) could not be cancelled/,
      );
    } finally {
      spy.mockRestore();
    }
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: bookings[1]! } })).status).toBe('CANCELLED');
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: bookings[0]! } })).status).toBe('CONFIRMED');

    // The reconciler re-enqueues the show; with the fault gone the leftover booking is cancelled.
    await t.get<BookingService>(BookingService).reconcileCancelledShows();
    await eventually(async () => {
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: bookings[0]! } })).status).toBe('CANCELLED');
    }, 30_000);
  });

  it('[follow-up #3] a customer cancellation loses the race against a door check-in', async () => {
    const { showId } = await createOnSaleShow(t, manager);
    const c = await customer();
    const held = await hold(c.auth, showId, ['B1']).expect(201);
    const order = await initiate(c.auth, held.body.id as string);
    await t.http
      .post(`${API}/payments/verify`)
      .set(c.auth)
      .send(fake.completeCheckout(order.body.orderId as string))
      .expect(200);
    await prisma.booking.update({ where: { id: held.body.id as string }, data: { checkedInAt: new Date() } });
    const service = t.get<BookingService>(BookingService) as unknown as { cancelConfirmed: (...args: unknown[]) => Promise<void> };
    await expect(service.cancelConfirmed(null, held.body.id, 100, 'customer_cancel')).rejects.toThrow(/no longer confirmed/);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: held.body.id as string } })).status).toBe('CONFIRMED');
  });

  it('[follow-up #4] a crashed key is not reclaimable with a different request body', async () => {
    const { showId } = await createOnSaleShow(t, manager);
    const c = await customer();
    const key = idem();
    await prisma.idempotencyKey.create({
      data: {
        userId: c.id,
        route: 'POST /api/v1/bookings/hold',
        key,
        requestHash: 'f'.repeat(64),
        createdAt: new Date(Date.now() - 5 * 60_000),
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    const res = await t.http
      .post(`${API}/bookings/hold`)
      .set(c.auth)
      .set('Idempotency-Key', key)
      .send({ showId, seatIds: ['B2'] })
      .expect(422);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });
});

describe('code follow-up fixes', () => {
  it('[code follow-up HIGH] cancelling during a show cancellation refunds in full, without the fee', async () => {
    const { showId } = await createOnSaleShow(t, manager);
    const c = await customer();
    const held = await hold(c.auth, showId, ['B4']).expect(201);
    const order = await initiate(c.auth, held.body.id as string);
    await t.http
      .post(`${API}/payments/verify`)
      .set(c.auth)
      .send(fake.completeCheckout(order.body.orderId as string))
      .expect(200);
    const { ManagerCatalogService } = await import('../../src/modules/events/manager-catalog.service.js');
    await t
      .get<InstanceType<typeof ManagerCatalogService>>(ManagerCatalogService)
      .markShowCancelled({ id: manager.id, role: 'MANAGER', status: 'ACTIVE' }, showId);

    await t.http
      .post(`${API}/bookings/${held.body.id as string}/cancel`)
      .set(c.auth)
      .set('Idempotency-Key', idem())
      .expect(200);
    const refund = await prisma.refund.findFirstOrThrow({ where: { payment: { bookingId: held.body.id as string } } });
    expect(refund).toMatchObject({ reason: 'show_cancelled' });
    expect(refund.amount.toFixed(2)).toBe(held.body.totalAmount); // full total (B4 is a 400.00 STD seat), no fee
  });

  it('[code follow-up] tickets of a cancelled show are not admitted', async () => {
    const { showId } = await createOnSaleShow(t, manager);
    const c = await customer();
    const held = await hold(c.auth, showId, ['B5']).expect(201);
    const order = await initiate(c.auth, held.body.id as string);
    await t.http
      .post(`${API}/payments/verify`)
      .set(c.auth)
      .send(fake.completeCheckout(order.body.orderId as string))
      .expect(200);
    const { ticketCode } = (
      await t.http
        .get(`${API}/bookings/${held.body.id as string}/ticket`)
        .set(c.auth)
        .expect(200)
    ).body as { ticketCode: string };
    const { ManagerCatalogService } = await import('../../src/modules/events/manager-catalog.service.js');
    await t
      .get<InstanceType<typeof ManagerCatalogService>>(ManagerCatalogService)
      .markShowCancelled({ id: manager.id, role: 'MANAGER', status: 'ACTIVE' }, showId);
    const res = await t.http.post(`${API}/manager/tickets/verify`).set(manager.auth).send({ code: ticketCode }).expect(200);
    expect(res.body).toMatchObject({ valid: false, reason: 'SHOW_CANCELLED' });
  });

  it('[code follow-up] HTTP metrics record the final status, including guard rejections', async () => {
    await t.http.get(`${API}/bookings`).expect(401);
    await t.http.get(`${API}/events/${'f'.repeat(24)}`).expect(404);
    const text = (await t.http.get(`${API}/metrics`).expect(200)).text;
    expect(text).toMatch(/http_request_duration_seconds_count\{method="GET",route="\/api\/v1\/bookings",status="401"\} \d+/);
    expect(text).toMatch(/http_request_duration_seconds_count\{method="GET",route="\/api\/v1\/events\/:idOrSlug",status="404"\} \d+/);
  });
});
