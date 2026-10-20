/**
 * Phases 2–7 exit criteria through the real API: catalog ownership, the seat
 * race, payments (checkout, webhook, duplicate, late), expiry, cancellations,
 * notifications, audit trail, reports and live seat updates.
 */
import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import { inject } from 'vitest';
import { BookingService } from '../../src/modules/booking/booking.service.js';
import { TokenService } from '../../src/modules/auth/token.service.js';
import { FakePaymentProvider } from '../../src/modules/payment/providers/fake.provider.js';
import { PAYMENT_PROVIDER } from '../../src/modules/payment/providers/payment-provider.js';
import { PrismaService } from '../../src/infra/prisma/prisma.service.js';
import { API, createOnSaleShow, createUser, eventually, idem, resetRateLimits, startApp, type TestApp } from './support/app.js';

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

/** Many customers quickly: inserted directly, tokens minted by the real TokenService. */
async function fastCustomers(n: number) {
  const tokens = t.get<TokenService>(TokenService);
  const users = Array.from({ length: n }, () => ({ id: randomUUID(), email: `race-${randomUUID().slice(0, 12)}@e2e.test` }));
  await prisma.user.createMany({ data: users.map((u) => ({ ...u, name: 'Racer', role: 'CUSTOMER', passwordHash: 'x' })) });
  return Promise.all(
    users.map(async (u) => ({
      id: u.id,
      auth: { Authorization: `Bearer ${await tokens.signAccess({ id: u.id, role: 'CUSTOMER', status: 'ACTIVE' })}` },
    })),
  );
}

const hold = (auth: Record<string, string>, showId: string, seatIds: string[], key = idem()) =>
  t.http.post(`${API}/bookings/hold`).set(auth).set('Idempotency-Key', key).send({ showId, seatIds });

async function pay(auth: Record<string, string>, bookingId: string) {
  const init = await t.http.post(`${API}/payments/initiate`).set(auth).set('Idempotency-Key', idem()).send({ bookingId }).expect(201);
  const confirmation = fake.completeCheckout(init.body.orderId as string);
  return { init: init.body, confirmation, verify: () => t.http.post(`${API}/payments/verify`).set(auth).send(confirmation) };
}

/** Moves a hold's single expiry clock into the past (booking + seats together), then runs the sweeper. */
async function forceExpire(bookingId: string) {
  await prisma.$transaction([
    prisma.$executeRaw`UPDATE bookings SET hold_expires_at = now() - interval '1 second' WHERE id = ${bookingId}::uuid`,
    prisma.$executeRaw`UPDATE show_seats SET hold_expires_at = now() - interval '1 second' WHERE booking_id = ${bookingId}::uuid`,
  ]);
  await t.get<BookingService>(BookingService).sweepExpired();
}

const mailpit = inject('infra').mailpitApi;
async function mailTo(email: string, subject: RegExp) {
  return eventually(async () => {
    const res = await fetch(`${mailpit}/search?query=${encodeURIComponent(`to:${email}`)}`);
    const body = (await res.json()) as { messages: Array<{ ID: string; Subject: string }> };
    const message = body.messages.find((m) => subject.test(m.Subject));
    if (!message) throw new Error(`no mail "${subject}" for ${email}`);
    return message;
  }, 30_000);
}

describe('catalog ownership and rules', () => {
  it("hides one manager's resources from another (404, not 403)", async () => {
    const { venueId, showId } = await createOnSaleShow(t, manager);
    const other = await createUser(t, 'MANAGER');
    expect((await t.http.get(`${API}/manager/venues/${venueId}`).set(other.auth).expect(404)).body.error.code).toBe('VENUE_NOT_FOUND');
    await t.http
      .post(`${API}/manager/shows/${showId}/seats/block`)
      .set(other.auth)
      .send({ seatIds: ['A1'] })
      .expect(404);
    await t.http.get(`${API}/manager/shows/${showId}/bookings`).set(other.auth).expect(404);
  });

  it('requires pricing for exactly the layout tiers', async () => {
    const { venueId, eventId } = await createOnSaleShow(t, manager);
    const startsAt = new Date(Date.now() + 10 * 86_400_000);
    const res = await t.http
      .post(`${API}/manager/shows`)
      .set(manager.auth)
      .send({
        eventId,
        venueId,
        hallId: 'h1',
        startsAt: startsAt.toISOString(),
        endsAt: new Date(startsAt.getTime() + 3600_000).toISOString(),
        pricing: { VIP: 100, GOLD: 5 },
      })
      .expect(400);
    expect(res.body.error).toMatchObject({ code: 'PRICING_MISMATCH', details: { missing: ['STD'], unknown: ['GOLD'] } });
  });

  it('exposes on-sale shows publicly with a live seat map', async () => {
    const { eventId, showId } = await createOnSaleShow(t, manager, { city: 'nagpur' });
    expect((await t.http.get(`${API}/cities`).expect(200)).body).toContain('nagpur');
    const browse = await t.http.get(`${API}/events?city=nagpur`).expect(200);
    expect(browse.body.data.map((e: { id: string }) => e.id)).toContain(eventId);
    const map = await t.http.get(`${API}/shows/${showId}/seats`).expect(200);
    expect(map.body).toMatchObject({ totalSeats: 10, availableSeats: 10, currency: 'INR' });
    expect(map.body.sections[0]).toMatchObject({ code: 'VIP', price: '1000.00' });
  });

  it('blocks seats so they cannot be held', async () => {
    const { showId } = await createOnSaleShow(t, manager);
    const blocked = await t.http
      .post(`${API}/manager/shows/${showId}/seats/block`)
      .set(manager.auth)
      .send({ seatIds: ['B5', 'B5', 'ZZ9'] })
      .expect(200);
    expect(blocked.body).toEqual({ changed: ['B5'], skipped: ['ZZ9'] });
    const [customer] = await fastCustomers(1);
    expect((await hold(customer!.auth, showId, ['B5']).expect(409)).body.error.code).toBe('SEATS_UNAVAILABLE');
  });
});

describe('holding seats', () => {
  it('lets exactly one of 500 concurrent customers hold the same seat', async () => {
    const { showId } = await createOnSaleShow(t, manager);
    const customers = await fastCustomers(500);
    const results = await Promise.all(customers.map((c) => hold(c.auth, showId, ['A1'])));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(499);
    const rows = await prisma.showSeat.findMany({ where: { showId, seatId: 'A1' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'HELD' });
    expect(await prisma.booking.count({ where: { showId, status: 'PENDING' } })).toBe(1);
  });

  it('replays an idempotent hold and rejects a reused key with a different body', async () => {
    const { showId } = await createOnSaleShow(t, manager);
    const [c] = await fastCustomers(1);
    const key = idem();
    const first = await hold(c!.auth, showId, ['A2'], key).expect(201);
    const replay = await hold(c!.auth, showId, ['A2'], key).expect(201);
    expect(replay.body.id).toBe(first.body.id);
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect((await hold(c!.auth, showId, ['A3'], key).expect(422)).body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(
      (
        await t.http
          .post(`${API}/bookings/hold`)
          .set(c!.auth)
          .send({ showId, seatIds: ['A4'] })
          .expect(400)
      ).body.error.code,
    ).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('enforces per-booking seat and per-customer hold limits', async () => {
    const { showId } = await createOnSaleShow(t, manager);
    const [c] = await fastCustomers(1);
    const all = ['A1', 'A2', 'A3', 'A4', 'A5', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6'];
    expect((await hold(c!.auth, showId, all).expect(400)).body.error.code).toBe('TOO_MANY_SEATS');
    await hold(c!.auth, showId, ['A1']).expect(201);
    await hold(c!.auth, showId, ['A2']).expect(201);
    expect((await hold(c!.auth, showId, ['A3']).expect(409)).body.error.code).toBe('TOO_MANY_ACTIVE_HOLDS');
  });

  it('pushes seat changes to connected seat maps over WebSocket', async () => {
    const { showId } = await createOnSaleShow(t, manager);
    const socket: Socket = io(`${t.url}/seats`, { transports: ['websocket'], forceNew: true });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.on('connect', () => resolve());
        socket.on('connect_error', reject);
      });
      expect(await socket.emitWithAck('show:join', showId)).toEqual({ ok: true });
      const update = new Promise<{ seatIds: string[]; status: string }>((resolve) => socket.once('seats:update', resolve));
      const [c] = await fastCustomers(1);
      await hold(c!.auth, showId, ['B2', 'B3']).expect(201);
      expect(await update).toMatchObject({ showId, seatIds: ['B2', 'B3'], status: 'UNAVAILABLE' });
    } finally {
      socket.disconnect();
    }
  });

  it('releases seats when a hold expires', async () => {
    const { showId } = await createOnSaleShow(t, manager);
    const [a, b] = await fastCustomers(2);
    const held = await hold(a!.auth, showId, ['A5']).expect(201);
    await forceExpire(held.body.id as string);
    expect(
      (
        await t.http
          .get(`${API}/bookings/${held.body.id as string}`)
          .set(a!.auth)
          .expect(200)
      ).body.status,
    ).toBe('EXPIRED');
    await hold(b!.auth, showId, ['A5']).expect(201);
  });
});

describe('payments', () => {
  it('confirms a paid booking, emails the ticket and records the audit trail', async () => {
    const { showId } = await createOnSaleShow(t, manager);
    const customer = await createUser(t, 'CUSTOMER');
    const held = await hold(customer.auth, showId, ['A1', 'B1']).expect(201);
    expect(held.body).toMatchObject({ status: 'PENDING', totalAmount: '1400.00' });

    const { init, verify } = await pay(customer.auth, held.body.id as string);
    const again = await t.http
      .post(`${API}/payments/initiate`)
      .set(customer.auth)
      .set('Idempotency-Key', idem())
      .send({ bookingId: held.body.id })
      .expect(201);
    expect(again.body.orderId).toBe(init.orderId); // open order is reused
    const verified = await verify().expect(200);
    expect(verified.body).toMatchObject({ outcome: 'confirmed', booking: { status: 'CONFIRMED', paymentStatus: 'CAPTURED' } });
    expect((await verify().expect(200)).body.outcome).toBe('already_settled');

    const ticket = await t.http
      .get(`${API}/bookings/${held.body.id as string}/ticket`)
      .set(customer.auth)
      .expect(200);
    expect(ticket.body.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(
      (await t.http.post(`${API}/manager/tickets/verify`).set(manager.auth).send({ code: ticket.body.ticketCode }).expect(200)).body.valid,
    ).toBe(true);

    const mail = await mailTo(customer.email, /Booking confirmed/);
    const detail = (await (await fetch(`${mailpit}/message/${mail.ID}`)).json()) as {
      Inline: Array<{ ContentType: string }>;
      HTML: string;
    };
    expect(detail.Inline).toMatchObject([{ ContentType: 'image/png' }]); // ticket QR, referenced as cid:ticket-qr
    expect(detail.HTML).toContain('cid:ticket-qr');
    await eventually(async () => {
      expect(await prisma.auditLog.count({ where: { entityId: held.body.id as string, action: 'booking.held' } })).toBe(1);
    });
  });

  it('rejects forged checkout signatures and foreign bookings', async () => {
    const { showId } = await createOnSaleShow(t, manager);
    const [a, b] = await fastCustomers(2);
    const held = await hold(a!.auth, showId, ['A3']).expect(201);
    const { confirmation } = await pay(a!.auth, held.body.id as string);
    expect(
      (
        await t.http
          .post(`${API}/payments/verify`)
          .set(a!.auth)
          .send({ ...confirmation, signature: 'a'.repeat(64) })
          .expect(400)
      ).body.error.code,
    ).toBe('PAYMENT_SIGNATURE_INVALID');
    await t.http.post(`${API}/payments/verify`).set(b!.auth).send(confirmation).expect(404);
    await t.http.post(`${API}/payments/initiate`).set(b!.auth).set('Idempotency-Key', idem()).send({ bookingId: held.body.id }).expect(404);
  });

  it('settles via signed webhook, ignores duplicates and rejects bad signatures', async () => {
    const { showId } = await createOnSaleShow(t, manager);
    const [c] = await fastCustomers(1);
    const held = await hold(c!.auth, showId, ['A4']).expect(201);
    const { init, confirmation } = await pay(c!.auth, held.body.id as string);
    const body = JSON.stringify({
      kind: 'payment.captured',
      eventId: `evt_${randomUUID()}`,
      orderId: init.orderId,
      paymentId: confirmation.paymentId,
      amountMinor: 100000,
      currency: 'INR',
    });

    await t.http
      .post(`${API}/payments/webhook/fake`)
      .set('Content-Type', 'application/json')
      .set('x-fake-signature', '0'.repeat(64))
      .send(body)
      .expect(401);
    const ok = await t.http
      .post(`${API}/payments/webhook/fake`)
      .set('Content-Type', 'application/json')
      .set('x-fake-signature', fake.signWebhook(body))
      .send(body)
      .expect(200);
    expect(ok.body).toEqual({ received: true, duplicate: false });
    const dup = await t.http
      .post(`${API}/payments/webhook/fake`)
      .set('Content-Type', 'application/json')
      .set('x-fake-signature', fake.signWebhook(body))
      .send(body)
      .expect(200);
    expect(dup.body).toEqual({ received: true, duplicate: true });
    expect(
      (
        await t.http
          .get(`${API}/bookings/${held.body.id as string}`)
          .set(c!.auth)
          .expect(200)
      ).body.status,
    ).toBe('CONFIRMED');
  });

  it('refunds a second capture for an already-paid booking', async () => {
    const { showId } = await createOnSaleShow(t, manager);
    const [c] = await fastCustomers(1);
    const held = await hold(c!.auth, showId, ['B4']).expect(201);
    await (await pay(c!.auth, held.body.id as string)).verify().expect(200);

    // A second order for the same booking gets paid (e.g. two browser tabs).
    const { orderId } = await fake.createOrder({
      amountMinor: 40000,
      currency: 'INR',
      receipt: 'dup',
      idempotencyKey: `${held.body.id as string}:dup`,
    });
    await prisma.payment.create({
      data: {
        bookingId: held.body.id as string,
        provider: 'fake',
        providerOrderId: orderId,
        amount: '400.00',
        currency: 'INR',
        idempotencyKey: `${held.body.id as string}:dup`,
      },
    });
    const second = fake.completeCheckout(orderId);
    expect((await t.http.post(`${API}/payments/verify`).set(c!.auth).send(second).expect(200)).body.outcome).toBe('duplicate_refunded');

    await eventually(async () => {
      const duplicate = await prisma.payment.findUniqueOrThrow({ where: { providerOrderId: orderId }, include: { refunds: true } });
      expect(duplicate.status).toBe('REFUNDED');
      expect(duplicate.refunds).toMatchObject([{ status: 'PROCESSED', amount: expect.anything(), reason: 'duplicate_payment' }]);
    });
    expect(
      (
        await t.http
          .get(`${API}/bookings/${held.body.id as string}`)
          .set(c!.auth)
          .expect(200)
      ).body.status,
    ).toBe('CONFIRMED');
  });

  it('confirms a late payment when the seats are still free', async () => {
    const { showId } = await createOnSaleShow(t, manager);
    const [c] = await fastCustomers(1);
    const held = await hold(c!.auth, showId, ['A2']).expect(201);
    const { verify } = await pay(c!.auth, held.body.id as string);
    await forceExpire(held.body.id as string);
    expect((await verify().expect(200)).body).toMatchObject({ outcome: 'confirmed', booking: { status: 'CONFIRMED' } });
    expect((await prisma.showSeat.findFirstOrThrow({ where: { showId, seatId: 'A2' } })).status).toBe('BOOKED');
  });

  it('refunds a late payment when someone else took the seats meanwhile', async () => {
    const { showId } = await createOnSaleShow(t, manager);
    const [late, other] = await fastCustomers(2);
    const held = await hold(late!.auth, showId, ['B3']).expect(201);
    const { verify } = await pay(late!.auth, held.body.id as string);
    await forceExpire(held.body.id as string);
    await hold(other!.auth, showId, ['B3']).expect(201);

    expect((await verify().expect(200)).body).toMatchObject({ outcome: 'refunded_seats_unavailable', booking: { status: 'EXPIRED' } });
    await eventually(async () => {
      const refunds = await prisma.refund.findMany({ where: { payment: { bookingId: held.body.id as string } } });
      expect(refunds).toMatchObject([{ status: 'PROCESSED', reason: 'late_payment_seats_taken' }]);
    });
  });
});

describe('cancellations and reports', () => {
  it('cancels within the window: seats released, refund minus fee, email sent', async () => {
    const { showId } = await createOnSaleShow(t, manager);
    const customer = await createUser(t, 'CUSTOMER');
    const held = await hold(customer.auth, showId, ['A1']).expect(201);
    await (await pay(customer.auth, held.body.id as string)).verify().expect(200);

    const cancelled = await t.http
      .post(`${API}/bookings/${held.body.id as string}/cancel`)
      .set(customer.auth)
      .set('Idempotency-Key', idem())
      .expect(200);
    expect(cancelled.body.status).toBe('CANCELLED');
    expect((await prisma.showSeat.findFirstOrThrow({ where: { showId, seatId: 'A1' } })).status).toBe('AVAILABLE');
    await eventually(async () => {
      const refund = await prisma.refund.findFirstOrThrow({ where: { payment: { bookingId: held.body.id as string } } });
      expect(refund).toMatchObject({ status: 'PROCESSED', reason: 'customer_cancel' });
      expect(refund.amount.toFixed(2)).toBe('900.00'); // 1000.00 − 10 % fee
    });
    await mailTo(customer.email, /Booking cancelled/);
    expect(
      (
        await t.http
          .post(`${API}/bookings/${held.body.id as string}/cancel`)
          .set(customer.auth)
          .set('Idempotency-Key', idem())
          .expect(409)
      ).body.error.code,
    ).toBe('BOOKING_NOT_CANCELLABLE');
  });

  it('refuses cancellation inside the cut-off window', async () => {
    const { showId } = await createOnSaleShow(t, manager, { startsInHours: 2 });
    const [c] = await fastCustomers(1);
    const held = await hold(c!.auth, showId, ['A1']).expect(201);
    await (await pay(c!.auth, held.body.id as string)).verify().expect(200);
    expect(
      (
        await t.http
          .post(`${API}/bookings/${held.body.id as string}/cancel`)
          .set(c!.auth)
          .set('Idempotency-Key', idem())
          .expect(409)
      ).body.error.code,
    ).toBe('CANCELLATION_WINDOW_CLOSED');
  });

  it('cancelling a show refunds every booking in full and takes it off sale', async () => {
    const { showId } = await createOnSaleShow(t, manager);
    const [a, b, pending] = await fastCustomers(3);
    const bookings: string[] = [];
    for (const [c, seat] of [
      [a!, 'A1'],
      [b!, 'A2'],
    ] as const) {
      const held = await hold(c.auth, showId, [seat]).expect(201);
      await (await pay(c.auth, held.body.id as string)).verify().expect(200);
      bookings.push(held.body.id as string);
    }
    const open = await hold(pending!.auth, showId, ['B1']).expect(201);

    const res = await t.http.post(`${API}/manager/shows/${showId}/cancel`).set(manager.auth).expect(202);
    expect(res.body).toMatchObject({ status: 'CANCELLING', show: { status: 'CANCELLED' } });
    await eventually(async () => {
      expect(await prisma.booking.count({ where: { id: { in: bookings }, status: 'CANCELLED' } })).toBe(2);
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: open.body.id as string } })).status).toBe('EXPIRED');
      const refunds = await prisma.refund.findMany({ where: { payment: { bookingId: { in: bookings } } } });
      expect(refunds.map((r) => [r.status, r.amount.toFixed(2)])).toEqual([
        ['PROCESSED', '1000.00'],
        ['PROCESSED', '1000.00'],
      ]);
    }, 30_000);
    // Every seat of a cancelled show ends up blocked; cancelling again is harmless.
    expect(await prisma.showSeat.count({ where: { showId, status: { not: 'BLOCKED' } } })).toBe(0);
    await t.http.post(`${API}/manager/shows/${showId}/cancel`).set(manager.auth).expect(202);
    await t.http.get(`${API}/shows/${showId}/seats`).expect(404);
    expect((await hold(pending!.auth, showId, ['B2']).expect(409)).body.error.code).toBe('SHOW_NOT_ON_SALE');
  });

  it('reports sales and occupancy for the manager only', async () => {
    const reporter = await createUser(t, 'MANAGER');
    const { showId } = await createOnSaleShow(t, reporter);
    const [c] = await fastCustomers(1);
    const held = await hold(c!.auth, showId, ['A1', 'A2']).expect(201);
    await (await pay(c!.auth, held.body.id as string)).verify().expect(200);

    const report = await t.http.get(`${API}/manager/reports/sales`).set(reporter.auth).expect(200);
    expect(report.body.totals).toMatchObject({
      shows: 1,
      seatsSold: 2,
      confirmedBookings: 1,
      grossRevenue: '2000.00',
      netRevenue: '2000.00',
    });
    expect(report.body.shows[0]).toMatchObject({ seats: { total: 10, sold: 2 }, occupancyPercent: 20 });
    const bookings = await t.http.get(`${API}/manager/shows/${showId}/bookings`).set(reporter.auth).expect(200);
    expect(bookings.body.data[0].customer.email).toMatch(/^r\*\*\*@e2e\.test$/);
  });
});
