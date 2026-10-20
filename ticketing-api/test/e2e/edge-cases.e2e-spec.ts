/**
 * Edge paths of booking and payment: provider failures, mismatched captures,
 * refund webhooks, non-payable bookings, holds released or expired by workers,
 * and authorization boundaries between customers and managers.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { QUEUES, QueueService } from '../../src/infra/queue/queue.service.js';
import { PrismaService } from '../../src/infra/prisma/prisma.service.js';
import { TokenService } from '../../src/modules/auth/token.service.js';
import { BookingService } from '../../src/modules/booking/booking.service.js';
import { FakePaymentProvider } from '../../src/modules/payment/providers/fake.provider.js';
import { PAYMENT_PROVIDER } from '../../src/modules/payment/providers/payment-provider.js';
import { API, createOnSaleShow, createUser, eventually, idem, resetRateLimits, startApp, type TestApp } from './support/app.js';

const FAKE_SECRET = 'e2e-fake-payment-secret';

let t: TestApp;
let prisma: PrismaService;
let fake: FakePaymentProvider;
let manager: Awaited<ReturnType<typeof createUser>>;
let showId: string;

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
  ({ showId } = await createOnSaleShow(t, manager));
});

async function customer() {
  const id = randomUUID();
  await prisma.user.create({ data: { id, email: `edge-${id.slice(0, 8)}@e2e.test`, name: 'Edge', role: 'CUSTOMER', passwordHash: 'x' } });
  const token = await t.get<TokenService>(TokenService).signAccess({ id, role: 'CUSTOMER', status: 'ACTIVE' });
  return { id, auth: { Authorization: `Bearer ${token}` } };
}

const hold = (auth: Record<string, string>, seatIds: string[], show = showId) =>
  t.http.post(`${API}/bookings/hold`).set(auth).set('Idempotency-Key', idem()).send({ showId: show, seatIds });

const initiate = (auth: Record<string, string>, bookingId: string) =>
  t.http.post(`${API}/payments/initiate`).set(auth).set('Idempotency-Key', idem()).send({ bookingId });

const webhook = (body: object) => {
  const raw = JSON.stringify(body);
  return t.http
    .post(`${API}/payments/webhook/fake`)
    .set('Content-Type', 'application/json')
    .set('x-fake-signature', fake.signWebhook(raw))
    .send(raw);
};

describe('payment edge paths', () => {
  it('keeps the booking payable after a failed payment and opens a new order for the retry', async () => {
    const c = await customer();
    const held = await hold(c.auth, ['A1']).expect(201);
    const first = await initiate(c.auth, held.body.id as string).expect(201);
    await webhook({
      kind: 'payment.failed',
      eventId: `evt_${randomUUID()}`,
      orderId: first.body.orderId,
      paymentId: 'pay_x',
      reason: 'card declined',
    }).expect(200);
    expect((await prisma.payment.findUniqueOrThrow({ where: { providerOrderId: first.body.orderId as string } })).status).toBe('FAILED');

    const retry = await initiate(c.auth, held.body.id as string).expect(201);
    expect(retry.body.orderId).not.toBe(first.body.orderId);
    expect(await prisma.payment.count({ where: { bookingId: held.body.id as string } })).toBe(2);
    expect(
      (
        await t.http
          .get(`${API}/bookings/${held.body.id as string}`)
          .set(c.auth)
          .expect(200)
      ).body.status,
    ).toBe('PENDING');
  });

  it('does not confirm when the captured amount differs from the order', async () => {
    const c = await customer();
    const held = await hold(c.auth, ['A2']).expect(201);
    const order = await initiate(c.auth, held.body.id as string).expect(201);
    await webhook({
      kind: 'payment.captured',
      eventId: `evt_${randomUUID()}`,
      orderId: order.body.orderId,
      paymentId: 'pay_short',
      amountMinor: 1,
      currency: 'INR',
    }).expect(200);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { providerOrderId: order.body.orderId as string } });
    expect(payment.status).toBe('CREATED');
    expect(payment.rawResponse).toMatchObject({ amountMismatch: { capturedMinor: 1 } });
    expect(
      (
        await t.http
          .get(`${API}/bookings/${held.body.id as string}`)
          .set(c.auth)
          .expect(200)
      ).body.status,
    ).toBe('PENDING');
  });

  it('reports pending capture when the provider has not captured the payment yet', async () => {
    const c = await customer();
    const held = await hold(c.auth, ['A3']).expect(201);
    const order = await initiate(c.auth, held.body.id as string).expect(201);
    const paymentId = 'pay_authorized_only';
    const signature = createHmac('sha256', FAKE_SECRET)
      .update(`${order.body.orderId as string}|${paymentId}`)
      .digest('hex');
    const res = await t.http
      .post(`${API}/payments/verify`)
      .set(c.auth)
      .send({ orderId: order.body.orderId, paymentId, signature })
      .expect(200);
    expect(res.body).toMatchObject({ outcome: 'pending_capture', booking: { status: 'PENDING' } });
  });

  it('refuses payment for bookings that are no longer payable', async () => {
    const c = await customer();
    const held = await hold(c.auth, ['A4']).expect(201);
    await t.http
      .delete(`${API}/bookings/${held.body.id as string}/hold`)
      .set(c.auth)
      .expect(204);
    expect((await initiate(c.auth, held.body.id as string).expect(409)).body.error.code).toBe('BOOKING_NOT_PAYABLE');
  });

  it('refunds money captured for a FAILED booking', async () => {
    const c = await customer();
    const held = await hold(c.auth, ['A5']).expect(201);
    const bookingId = held.body.id as string;
    const order = await initiate(c.auth, bookingId).expect(201);
    await prisma.$transaction([
      prisma.$executeRaw`UPDATE bookings SET status = 'FAILED' WHERE id = ${bookingId}::uuid`,
      prisma.$executeRaw`UPDATE show_seats SET status = 'AVAILABLE', booking_id = NULL, hold_expires_at = NULL WHERE booking_id = ${bookingId}::uuid`,
    ]);
    const confirmation = fake.completeCheckout(order.body.orderId as string);
    expect((await t.http.post(`${API}/payments/verify`).set(c.auth).send(confirmation).expect(200)).body.outcome).toBe(
      'refunded_not_payable',
    );
    await eventually(async () => {
      expect(await prisma.refund.findFirstOrThrow({ where: { payment: { bookingId } } })).toMatchObject({
        status: 'PROCESSED',
        reason: 'booking_not_payable',
      });
    });
  });

  it('applies provider refund webhooks (processed and failed)', async () => {
    const c = await customer();
    const held = await hold(c.auth, ['B1']).expect(201);
    const order = await initiate(c.auth, held.body.id as string).expect(201);
    await t.http
      .post(`${API}/payments/verify`)
      .set(c.auth)
      .send(fake.completeCheckout(order.body.orderId as string))
      .expect(200);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { providerOrderId: order.body.orderId as string } });

    // Two partial refunds awaiting the provider (as Razorpay "pending" refunds would).
    const [ok, bad] = await Promise.all(
      ['rf_e2e_ok', 'rf_e2e_bad'].map((ref, i) =>
        prisma.refund.create({
          data: {
            paymentId: payment.id,
            amount: '100.00',
            reason: 'manual',
            status: 'PENDING',
            idempotencyKey: `${ref}-${randomUUID()}`,
            providerRefundId: `${ref}_${i}_${randomUUID().slice(0, 6)}`,
          },
        }),
      ),
    );
    await webhook({
      kind: 'refund.processed',
      eventId: `evt_${randomUUID()}`,
      refundId: ok!.providerRefundId,
      paymentId: payment.providerPaymentId,
      amountMinor: 10000,
    }).expect(200);
    await webhook({
      kind: 'refund.failed',
      eventId: `evt_${randomUUID()}`,
      refundId: bad!.providerRefundId,
      paymentId: payment.providerPaymentId,
    }).expect(200);
    await webhook({
      kind: 'refund.processed',
      eventId: `evt_${randomUUID()}`,
      refundId: 'rfnd_unknown',
      paymentId: 'x',
      amountMinor: 1,
    }).expect(200);
    await webhook({ kind: 'ignored', eventId: `evt_${randomUUID()}`, type: 'order.paid' }).expect(200);

    expect((await prisma.refund.findUniqueOrThrow({ where: { id: ok!.id } })).status).toBe('PROCESSED');
    expect((await prisma.refund.findUniqueOrThrow({ where: { id: bad!.id } })).status).toBe('FAILED');
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('CAPTURED'); // partial
  });

  it('rejects webhooks for other providers and unknown orders', async () => {
    await t.http.post(`${API}/payments/webhook/razorpay`).send({}).expect(404);
    const res = await webhook({
      kind: 'payment.captured',
      eventId: `evt_${randomUUID()}`,
      orderId: 'order_missing',
      paymentId: 'p',
      amountMinor: 1,
      currency: 'INR',
    });
    expect(res.status).toBe(404);
  });

  it('exposes the fake checkout helper only to customers', async () => {
    await t.http.post(`${API}/payments/fake/complete`).set(manager.auth).send({ orderId: 'order_x' }).expect(403);
  });
});

describe('booking edge paths', () => {
  it('validates seats and show availability before holding', async () => {
    const c = await customer();
    expect((await hold(c.auth, ['ZZ1']).expect(400)).body).toMatchObject({
      error: { code: 'SEAT_NOT_FOUND', details: { seatIds: ['ZZ1'] } },
    });
    expect((await hold(c.auth, ['A1', 'A1']).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
    await hold(c.auth, ['A1'], 'f'.repeat(24)).expect(404);
  });

  it('lets customers list, filter and release only their own bookings', async () => {
    const [a, b] = [await customer(), await customer()];
    const held = await hold(a.auth, ['B2']).expect(201);
    const id = held.body.id as string;

    expect((await t.http.get(`${API}/bookings?status=PENDING`).set(a.auth).expect(200)).body.data.map((x: { id: string }) => x.id)).toEqual(
      [id],
    );
    expect((await t.http.get(`${API}/bookings?status=CONFIRMED`).set(a.auth).expect(200)).body.data).toEqual([]);
    await t.http.get(`${API}/bookings/${id}`).set(b.auth).expect(404);
    await t.http.delete(`${API}/bookings/${id}/hold`).set(b.auth).expect(404);
    expect((await t.http.get(`${API}/bookings/${id}/ticket`).set(a.auth).expect(409)).body.error.code).toBe('BOOKING_NOT_CONFIRMED');
    expect((await t.http.post(`${API}/bookings/${id}/cancel`).set(a.auth).set('Idempotency-Key', idem()).expect(409)).body.error.code).toBe(
      'BOOKING_NOT_CANCELLABLE',
    );

    await t.http.delete(`${API}/bookings/${id}/hold`).set(a.auth).expect(204);
    expect((await t.http.delete(`${API}/bookings/${id}/hold`).set(a.auth).expect(409)).body.error.code).toBe('BOOKING_NOT_PENDING');
    expect((await prisma.showSeat.findFirstOrThrow({ where: { showId, seatId: 'B2' } })).status).toBe('AVAILABLE');
  });

  it('expires holds through the queue worker', async () => {
    const c = await customer();
    const held = await hold(c.auth, ['B3']).expect(201);
    const bookingId = held.body.id as string;
    await prisma.$transaction([
      prisma.$executeRaw`UPDATE bookings SET hold_expires_at = now() - interval '1 second' WHERE id = ${bookingId}::uuid`,
      prisma.$executeRaw`UPDATE show_seats SET hold_expires_at = now() - interval '1 second' WHERE booking_id = ${bookingId}::uuid`,
    ]);
    await t.get<QueueService>(QueueService).queue(QUEUES.bookingExpiry).add('expire', { bookingId });
    await eventually(async () => {
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })).status).toBe('EXPIRED');
    });
    // Expiring twice is a no-op.
    expect(await t.get<BookingService>(BookingService).expire(bookingId, 'timeout')).toBe(false);
  });

  it("refuses door checks for another manager's tickets and for non-confirmed bookings", async () => {
    const c = await customer();
    const held = await hold(c.auth, ['B4']).expect(201);
    const { createTicketCode } = await import('../../src/modules/booking/ticket-code.js');
    const code = createTicketCode('e2e-ticket-secret-0123456789abcdefghijklmnopq', held.body.id as string);
    expect((await t.http.post(`${API}/manager/tickets/verify`).set(manager.auth).send({ code }).expect(200)).body.valid).toBe(false);
    const other = await createUser(t, 'MANAGER');
    await t.http.post(`${API}/manager/tickets/verify`).set(other.auth).send({ code }).expect(404);
    const unknown = createTicketCode('e2e-ticket-secret-0123456789abcdefghijklmnopq', randomUUID());
    expect((await t.http.post(`${API}/manager/tickets/verify`).set(manager.auth).send({ code: unknown }).expect(400)).body.error.code).toBe(
      'TICKET_INVALID',
    );
  });

  it('validates report ranges', async () => {
    expect(
      (await t.http.get(`${API}/manager/reports/sales?from=2026-12-31&to=2026-01-01`).set(manager.auth).expect(400)).body.error.code,
    ).toBe('INVALID_RANGE');
    const empty = await createUser(t, 'MANAGER');
    expect((await t.http.get(`${API}/manager/reports/sales?from=2026-01-01&to=2026-01-31`).set(empty.auth).expect(200)).body.shows).toEqual(
      [],
    );
  });
});

describe('remaining reachable branches', () => {
  it('handles webhooks without an event id, repeated failures and pending provider refunds', async () => {
    const { PaymentService } = await import('../../src/modules/payment/payment.service.js');
    const payments = t.get<InstanceType<typeof PaymentService>>(PaymentService);
    const c = await customer();
    const held = await hold(c.auth, ['A1']).expect(201);
    const order = await initiate(c.auth, held.body.id as string).expect(201);

    // No event id → processed, but nothing to dedupe on.
    expect((await webhook({ kind: 'ignored', eventId: '', type: 'x' }).expect(200)).body).toEqual({ received: true, duplicate: false });
    // A second payment.failed for the same order changes nothing.
    for (let i = 0; i < 2; i++) {
      await webhook({
        kind: 'payment.failed',
        eventId: `evt_${randomUUID()}`,
        orderId: order.body.orderId,
        paymentId: 'p',
        reason: 'x',
      }).expect(200);
    }
    expect(
      await prisma.outboxEvent.count({
        where: {
          topic: 'payment.failed',
          aggregateId: (await prisma.payment.findUniqueOrThrow({ where: { providerOrderId: order.body.orderId as string } })).id,
        },
      }),
    ).toBe(1);

    // Pay with a fresh order, then cancel: the provider reports the refund as pending (Razorpay-style).
    const retry = await initiate(c.auth, held.body.id as string).expect(201);
    await t.http
      .post(`${API}/payments/verify`)
      .set(c.auth)
      .send(fake.completeCheckout(retry.body.orderId as string))
      .expect(200);
    const spy = vi
      .spyOn(fake, 'refund')
      .mockResolvedValue({ refundId: `rfnd_pending_${randomUUID().slice(0, 8)}`, status: 'pending' } as never);
    try {
      await t.http
        .post(`${API}/bookings/${held.body.id as string}/cancel`)
        .set(c.auth)
        .set('Idempotency-Key', idem())
        .expect(200);
      const refund = await eventually(async () => {
        const r = await prisma.refund.findFirstOrThrow({ where: { payment: { bookingId: held.body.id as string } } });
        expect(r.providerRefundId).toMatch(/^rfnd_pending_/);
        return r;
      });
      expect(refund.status).toBe('PENDING'); // awaits the provider's refund.processed webhook
      await payments.processRefund(refund.id); // already submitted → no second provider call
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
    await payments.processRefund(randomUUID()); // unknown refund → no-op
  });

  it('skips notifications for unknown bookings and rejects tampered tickets', async () => {
    const { NotificationConsumer } = await import('../../src/modules/notification/notification.consumer.js');
    expect(await t.get<BookingService>(BookingService).notificationContext(randomUUID())).toBeNull();
    await expect(
      t.get<InstanceType<typeof NotificationConsumer>>(NotificationConsumer).handle('booking.confirmed', { bookingId: randomUUID() }),
    ).resolves.toBeUndefined();
    expect(
      (await t.http.post(`${API}/manager/tickets/verify`).set(manager.auth).send({ code: 'TKT1.not-valid.at-all' }).expect(400)).body.error
        .code,
    ).toBe('TICKET_INVALID');
  });

  it('lists bookings unfiltered and filters show bookings by status', async () => {
    const c = await customer();
    const held = await hold(c.auth, ['B5']).expect(201);
    expect((await t.http.get(`${API}/bookings`).set(c.auth).expect(200)).body.meta.total).toBe(1);
    const pending = await t.http.get(`${API}/manager/shows/${showId}/bookings?status=PENDING`).set(manager.auth).expect(200);
    expect(pending.body.data.map((b: { id: string }) => b.id)).toContain(held.body.id);
    expect((await t.http.get(`${API}/manager/shows/${showId}/bookings?status=CONFIRMED`).set(manager.auth).expect(200)).body.data).toEqual(
      [],
    );
    const other = await customer();
    await t.http
      .post(`${API}/bookings/${held.body.id as string}/cancel`)
      .set(other.auth)
      .set('Idempotency-Key', idem())
      .expect(404);
  });

  it('reports shows without bookings and fully blocked shows at 0 % occupancy', async () => {
    const reporter = await createUser(t, 'MANAGER');
    const { showId: quiet } = await createOnSaleShow(t, reporter);
    await t.http
      .post(`${API}/manager/shows/${quiet}/seats/block`)
      .set(reporter.auth)
      .send({ seatIds: ['A1', 'A2', 'A3', 'A4', 'A5', 'B1', 'B2', 'B3', 'B4', 'B5'] })
      .expect(200);
    const report = await t.http.get(`${API}/manager/reports/sales`).set(reporter.auth).expect(200);
    expect(report.body.shows).toMatchObject([
      { seats: { total: 10, sold: 0, blocked: 10 }, occupancyPercent: 0, bookings: { confirmed: 0 }, grossRevenue: '0.00' },
    ]);
  });
});
