---
name: booking-integrity
description: Invariants, reference implementation, and review checklist for any code touching seat inventory, seat holds, bookings, payments, refunds, or the outbox. Use before writing or reviewing such code to guarantee no double booking, no lost money, and safe retries.
---

# Booking integrity

## Invariants
1. **Postgres is the authority** for seat state. Redis holds are a fast pre-check only.
2. Seat transitions allowed: `AVAILABLE→HELD`, `HELD→BOOKED`, `HELD→AVAILABLE`, `BOOKED→AVAILABLE` (cancel+refund only), `AVAILABLE↔BLOCKED`. *(DB trigger)*
3. Booking transitions: `PENDING→CONFIRMED|EXPIRED|FAILED`, `EXPIRED→CONFIRMED` (late payment only), `CONFIRMED→CANCELLED`. *(DB trigger)*
4. Every seat/booking/payment change and its `outbox` row are in **one transaction**.
5. A seat is BOOKED only by a CONFIRMED booking with a CAPTURED payment; a HELD seat only by a PENDING booking with the same `hold_expires_at`. *(deferred DB trigger, checked at COMMIT)*
6. Booking total = Σ item prices; items belong to the booking's show and currency; payment amount/currency = booking total/currency; refunds ≤ captured amount. *(DB triggers)*
7. Every mutation is **idempotent**: repeats return the same result and cause no extra side effects.
8. Webhook = source of truth for payment outcome; signature verified, event id deduped, amount verified.

The database rejects violations of 2, 3, 5 and 6 (`ticketing-api/prisma/migrations/*_init/migration.sql`, proven by `test/integration/postgres-invariants.int-spec.ts`). Code must still be written correctly — a DB rejection in production is a 500 and a bug.

## Reference: hold seats
```ts
// 1. Redis gate — atomic all-or-nothing (Lua)
const ok = await redis.holdSeats(showId, seatIds, bookingId, HOLD_TTL_MS); // SET NX PX for each, rollback on any failure
if (!ok) throw new DomainException('SEATS_UNAVAILABLE', '...', 409);

const holdUntil = new Date(Date.now() + HOLD_TTL_MS); // the ONE expiry clock — booking and seats share it
try {
  await prisma.$transaction(async (tx) => {
    // Booking first: show_seats.booking_id references it.
    const seats = await tx.showSeat.findMany({ where: { showId, seatId: { in: seatIds } }, select: { id: true, price: true, currency: true } });
    if (seats.length !== seatIds.length) throw new DomainException('SEATS_UNAVAILABLE', '...', 409);
    await tx.booking.create({ data: { id: bookingId, status: 'PENDING', holdExpiresAt: holdUntil,
      totalAmount: sumDecimal(seats.map((s) => s.price)), currency: seats[0].currency, /* … */
      items: { create: seats.map((s) => ({ showSeatId: s.id, price: s.price })) } } });
    const n = await tx.$executeRaw`
      UPDATE show_seats
         SET status = 'HELD', booking_id = ${bookingId}::uuid, hold_expires_at = ${holdUntil}, version = version + 1
       WHERE show_id = ${showId} AND seat_id = ANY(${seatIds}) AND status = 'AVAILABLE'`;
    if (n !== seatIds.length) throw new DomainException('SEATS_UNAVAILABLE', '...', 409); // rolls back everything
    await tx.outboxEvent.create({ data: { topic: 'booking.held', /* … */ } });
  });
} catch (e) {
  await redis.releaseSeats(showId, seatIds, bookingId); // only deletes keys whose value === bookingId
  throw e;
}
// after commit: HSET avail:{showId}, emit WS seats:update, enqueue hold-expiry job (delay until holdUntil)
```

## Reference: confirm on webhook
- Verify signature on the raw body → `INSERT processed_webhooks … ON CONFLICT DO NOTHING`; 0 rows ⇒ duplicate, return 200.
- Verify amount/currency equal the booking's.
- Booking already has a CAPTURED payment ⇒ store this one as `CAPTURED_DUPLICATE`, create refund `refund:{paymentId}:full`, return 200.
- Booking PENDING ⇒ one transaction: payment → CAPTURED; booking `… SET status='CONFIRMED', confirmed_at=now() WHERE id=$b AND status='PENDING'`; seats `… SET status='BOOKED', hold_expires_at=NULL WHERE booking_id=$b AND status='HELD'` (rowcount = item count); outbox `booking.confirmed`.
- Booking EXPIRED (late payment) ⇒ one transaction: re-hold exactly the item seats `AVAILABLE→HELD` with the booking's `hold_expires_at` (rowcount = item count, else go to refund path), capture, `EXPIRED→CONFIRMED`, seats `BOOKED`. Refund path: payment CAPTURED, booking stays EXPIRED, refund `refund:{paymentId}:full`, outbox `refund.requested`.

## Reference: expiry
- Driven **only** by bookings: cron every 60 s (+ BullMQ delayed job per booking) selects `bookings WHERE status='PENDING' AND hold_expires_at < now()` (partial index `bookings_pending_expiry_idx`).
- Per booking, one transaction: booking `… SET status='EXPIRED' WHERE id=$b AND status='PENDING'` (0 rows ⇒ already confirmed, stop); seats `HELD→AVAILABLE, booking_id=NULL, hold_expires_at=NULL WHERE booking_id=$b`; outbox `booking.expired`. After commit: release Redis keys, WS emit.
- Expiry and confirm race: both update the booking with `WHERE status='PENDING'` — exactly one wins; the deferred trigger rejects any mixed result.

## Reference: cancelled / finished shows
- `initiate` refuses payment unless the show is ON_SALE and not started; `settleCapture` reads show status first and **never confirms** for a non-ON_SALE show — it captures and refunds (`booking_not_payable`).
- `POST /manager/shows/:id/cancel` → show CANCELLED, all AVAILABLE seats BLOCKED, durable BullMQ job (`show-cancellations`, jobId per show, retried) cancels/refunds every booking and re-blocks released seats. A reconciler (every 5 min) re-enqueues cancelled shows that still have PENDING/CONFIRMED bookings. Re-calling cancel is safe.

## Reference: refunds
- The `refunds_bounds` trigger locks the payment row and rejects over-refunds.
- Payout (`processRefund`) takes a Redis lock `lock:refund:{id}` before calling the provider (no double submission across overlapping scans); the provider call carries the refund's idempotency key; worker concurrency 1.
- Failures back off exponentially (Redis `refund:backoff:{id}`); after 8 failures the refund becomes FAILED with an audit entry. Submitted refunds still PENDING after 10 min are reconciled via `provider.fetchRefund`. `markRefund` is a conditional PENDING → X update (exactly once).
- A second capture on an already-settled order is stored as its own `CAPTURED_DUPLICATE` payment row and refunded.
- Deterministic idempotency keys `rf:{paymentId}:{reasonCode}`, so concurrent cancel + auto-refund collapse to one row.

## Raw SQL notes
- Ids are UUID v7 generated by Prisma: raw `INSERT`s must supply `id` (`gen_random_uuid()` is acceptable).
- `created_at`/`updated_at` default to `now()`; raw `UPDATE`s should still set `updated_at = now()` (Prisma's `@updatedAt` only applies to Prisma calls).

## Review checklist
- [ ] Every seat UPDATE has a status precondition in `WHERE` and checks rowcount
- [ ] No read-then-write without lock/precondition (no `findFirst` then `update` on seat status)
- [ ] Outbox row written in the same transaction; no direct Kafka publish inside txn
- [ ] Redis release only removes keys owned by this booking (compare value)
- [ ] Idempotency key honored on hold/initiate/cancel; payment rows keyed `{bookingId}:{attempt}`, provider calls keyed bookingId / refund key
- [ ] Booking inserted before the seat UPDATE; seats copy the booking's `hold_expires_at`
- [ ] Double capture → `CAPTURED_DUPLICATE` + refund; late payment → re-hold or refund (never a stuck 23505 retry loop)
- [ ] Webhook signature verified and deduped
- [ ] Money in Decimal / minor units; no floats
- [ ] Expiry ↔ confirm ↔ cancel races covered by tests
- [ ] Concurrency test: N parallel holds for the same seat → exactly 1 success

## Required tests
- Integration (Testcontainers): 500 concurrent `hold` calls for one seat → 1 × 201, 499 × 409; DB has one HELD row.
- Confirm after expiry → refund path; duplicate webhook → single confirmation; expiry and confirm at the same instant → consistent final state.
