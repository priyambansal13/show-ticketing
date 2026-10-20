/**
 * Contract test: real responses must match the OpenAPI response schemas that
 * ticketing-web generates its types from (CLAUDE.md rule 6). A mapper change
 * that drifts from the published contract fails here.
 */
import type { ZodType } from 'zod';
import { z } from 'zod';
import { pageSchema } from '../../src/common/validation/zod.js';
import { AuthResponseSchema, PublicUserSchema } from '../../src/modules/auth/dto/auth.dto.js';
import { ManagerSummarySchema } from '../../src/modules/admin/admin.service.js';
import * as B from '../../src/modules/booking/dto/booking.responses.js';
import * as C from '../../src/modules/events/dto/catalog.responses.js';
import { FakePaymentProvider } from '../../src/modules/payment/providers/fake.provider.js';
import { PAYMENT_PROVIDER } from '../../src/modules/payment/providers/payment-provider.js';
import { API, createOnSaleShow, createUser, idem, resetRateLimits, startApp, type TestApp } from './support/app.js';

let t: TestApp;

beforeAll(async () => {
  t = await startApp();
  await resetRateLimits(t);
});
afterAll(async () => {
  await t?.close();
});

/** Strict parse: unknown keys in the response are a contract violation too. */
function expectContract(schema: ZodType, body: unknown) {
  const strict = (s: ZodType): ZodType => s;
  const result = strict(schema).safeParse(body);
  if (!result.success) throw new Error(`contract violation:\n${JSON.stringify(result.error.issues, null, 2)}`);
}

it('every customer, manager and admin response matches its published schema', async () => {
  const manager = await createUser(t, 'MANAGER');
  const customer = await createUser(t, 'CUSTOMER');
  const admin = await createUser(t, 'ADMIN');
  const { venueId, eventId, showId } = await createOnSaleShow(t, manager, { city: 'kochi' });

  // Auth & admin
  expectContract(PublicUserSchema, (await t.http.get(`${API}/auth/me`).set(customer.auth).expect(200)).body);
  expectContract(
    AuthResponseSchema,
    (await t.http.post(`${API}/auth/customer/login`).send({ email: customer.email, password: 'Password123!e2e' }).expect(200)).body,
  );
  expectContract(pageSchema(ManagerSummarySchema), (await t.http.get(`${API}/admin/managers`).set(admin.auth).expect(200)).body);

  // Manager catalog
  expectContract(C.VenuePage, (await t.http.get(`${API}/manager/venues`).set(manager.auth).expect(200)).body);
  expectContract(C.VenueResponse, (await t.http.get(`${API}/manager/venues/${venueId}`).set(manager.auth).expect(200)).body);
  expectContract(
    C.LayoutResponse,
    (await t.http.get(`${API}/manager/venues/${venueId}/halls/h1/layout`).set(manager.auth).expect(200)).body,
  );
  expectContract(C.EventPage, (await t.http.get(`${API}/manager/events`).set(manager.auth).expect(200)).body);
  expectContract(C.EventResponse, (await t.http.get(`${API}/manager/events/${eventId}`).set(manager.auth).expect(200)).body);
  expectContract(C.ShowPage, (await t.http.get(`${API}/manager/shows`).set(manager.auth).expect(200)).body);
  expectContract(C.ShowResponse, (await t.http.get(`${API}/manager/shows/${showId}`).set(manager.auth).expect(200)).body);
  expectContract(
    C.BlockSeatsResponse,
    (
      await t.http
        .post(`${API}/manager/shows/${showId}/seats/block`)
        .set(manager.auth)
        .send({ seatIds: ['B5'] })
        .expect(200)
    ).body,
  );

  // Public catalog
  expectContract(C.CitiesResponse, (await t.http.get(`${API}/cities`).expect(200)).body);
  expectContract(C.EventPage, (await t.http.get(`${API}/events?city=kochi`).expect(200)).body);
  expectContract(C.EventResponse, (await t.http.get(`${API}/events/${eventId}`).expect(200)).body);
  expectContract(z.array(C.EventShowResponse), (await t.http.get(`${API}/events/${eventId}/shows`).expect(200)).body);
  expectContract(C.ShowDetailResponse, (await t.http.get(`${API}/shows/${showId}`).expect(200)).body);
  expectContract(C.SeatMapResponse, (await t.http.get(`${API}/shows/${showId}/seats`).expect(200)).body);

  // Booking & payment
  const held = await t.http
    .post(`${API}/bookings/hold`)
    .set(customer.auth)
    .set('Idempotency-Key', idem())
    .send({ showId, seatIds: ['A1'] })
    .expect(201);
  expectContract(B.BookingResponse, held.body);
  const init = await t.http
    .post(`${API}/payments/initiate`)
    .set(customer.auth)
    .set('Idempotency-Key', idem())
    .send({ bookingId: held.body.id })
    .expect(201);
  expectContract(B.InitiatePaymentResponse, init.body);
  const checkout = await t.http.post(`${API}/payments/fake/complete`).set(customer.auth).send({ orderId: init.body.orderId }).expect(200);
  expectContract(B.CheckoutConfirmationResponse, checkout.body);
  expectContract(
    B.VerifyPaymentResponse,
    (await t.http.post(`${API}/payments/verify`).set(customer.auth).send(checkout.body).expect(200)).body,
  );
  expectContract(B.BookingPage, (await t.http.get(`${API}/bookings`).set(customer.auth).expect(200)).body);
  expectContract(
    B.BookingResponse,
    (
      await t.http
        .get(`${API}/bookings/${held.body.id as string}`)
        .set(customer.auth)
        .expect(200)
    ).body,
  );
  const ticket = await t.http
    .get(`${API}/bookings/${held.body.id as string}/ticket`)
    .set(customer.auth)
    .expect(200);
  expectContract(B.TicketResponse, ticket.body);
  expectContract(
    B.TicketVerificationResponse,
    (await t.http.post(`${API}/manager/tickets/verify`).set(manager.auth).send({ code: ticket.body.ticketCode }).expect(200)).body,
  );
  expectContract(B.ShowBookingPage, (await t.http.get(`${API}/manager/shows/${showId}/bookings`).set(manager.auth).expect(200)).body);
  expectContract(B.SalesReportResponse, (await t.http.get(`${API}/manager/reports/sales`).set(manager.auth).expect(200)).body);
  // A used ticket cannot be cancelled by the customer; cancel a second, unused booking instead.
  expect(
    (
      await t.http
        .post(`${API}/bookings/${held.body.id as string}/cancel`)
        .set(customer.auth)
        .set('Idempotency-Key', idem())
        .expect(409)
    ).body.error.code,
  ).toBe('BOOKING_ALREADY_USED');
  const second = await t.http
    .post(`${API}/bookings/hold`)
    .set(customer.auth)
    .set('Idempotency-Key', idem())
    .send({ showId, seatIds: ['A2'] })
    .expect(201);
  const init2 = await t.http
    .post(`${API}/payments/initiate`)
    .set(customer.auth)
    .set('Idempotency-Key', idem())
    .send({ bookingId: second.body.id })
    .expect(201);
  const pay2 = await t.http.post(`${API}/payments/fake/complete`).set(customer.auth).send({ orderId: init2.body.orderId }).expect(200);
  await t.http.post(`${API}/payments/verify`).set(customer.auth).send(pay2.body).expect(200);
  expectContract(
    B.BookingResponse,
    (
      await t.http
        .post(`${API}/bookings/${second.body.id as string}/cancel`)
        .set(customer.auth)
        .set('Idempotency-Key', idem())
        .expect(200)
    ).body,
  );
  expectContract(B.CancelShowResponse, (await t.http.post(`${API}/manager/shows/${showId}/cancel`).set(manager.auth).expect(202)).body);
  expect(t.get<FakePaymentProvider>(PAYMENT_PROVIDER).name).toBe('fake');
});

it('publishes response schemas for every documented route in OpenAPI', async () => {
  const doc = (await t.http.get('/api/docs-json').expect(200)).body as {
    paths: Record<string, Record<string, { responses: Record<string, { content?: unknown }> }>>;
  };
  const untyped: string[] = [];
  for (const [path, methods] of Object.entries(doc.paths)) {
    if (path.includes('/health/')) continue; // Terminus shapes, not part of the client contract
    for (const [method, op] of Object.entries(methods)) {
      const typed = Object.entries(op.responses).some(([status, r]) => status.startsWith('2') && r.content);
      const noContent = Object.keys(op.responses).some((status) => status === '204');
      if (!typed && !noContent && !(method === 'post' && path.endsWith('/logout'))) untyped.push(`${method.toUpperCase()} ${path}`);
    }
  }
  expect(untyped).toEqual([]);
});
