/**
 * Proves the database itself enforces the booking-integrity invariants,
 * independent of application code (docs/IMPLEMENTATION_PLAN.md §4.1, §5 and
 * the booking-integrity skill). Every multi-row change runs in a transaction in
 * the order the services will use: insert booking → insert items → conditional
 * seat UPDATE → commit (deferred consistency triggers fire at COMMIT).
 */
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { startMigratedPostgres } from './support/postgres.js';

const SHOW_A = 'a'.repeat(24);
const SHOW_B = 'b'.repeat(24);
const EVENT_ID = 'e'.repeat(24);

let container: StartedPostgreSqlContainer;
let pool: pg.Pool;
let userId: string;
let seatCounter = 0;

type Client = pg.PoolClient;

async function tx<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Inserts an AVAILABLE seat and returns its seat_id. */
async function seat(overrides: Record<string, unknown> = {}): Promise<string> {
  const seatId = (overrides['seat_id'] as string | undefined) ?? `S${++seatCounter}`;
  const columns = {
    id: randomUUID(),
    show_id: SHOW_A,
    event_id: EVENT_ID,
    section: 'GOLD',
    row_label: 'A',
    seat_number: 1,
    price_tier: 'GOLD',
    price: '350.00',
    currency: 'INR',
    ...overrides,
    seat_id: seatId,
  };
  const keys = Object.keys(columns);
  await pool.query(
    `INSERT INTO show_seats (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`,
    Object.values(columns),
  );
  return seatId;
}

const HOLD_UNTIL = () => new Date(Date.now() + 5 * 60_000);

/**
 * The hold flow the booking service will implement. Returns the booking id,
 * or null when any requested seat was not AVAILABLE (whole hold rolled back).
 */
async function hold(
  seatIds: string[],
  opts: { showId?: string; itemsShowId?: string; total?: string; holdUntil?: Date; seatHoldUntil?: Date } = {},
): Promise<string | null> {
  const bookingId = randomUUID();
  const showId = opts.showId ?? SHOW_A;
  const holdUntil = opts.holdUntil ?? HOLD_UNTIL();
  try {
    return await tx(async (c) => {
      const { rows } = await c.query<{ total: string }>(
        `SELECT coalesce(sum(price), 0)::text AS total FROM show_seats WHERE show_id = $1 AND seat_id = ANY($2)`,
        [opts.itemsShowId ?? showId, seatIds],
      );
      await c.query(
        `INSERT INTO bookings (id, booking_ref, user_id, show_id, event_id, total_amount, currency, hold_expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'INR', $7)`,
        [bookingId, bookingId.slice(0, 12), userId, showId, EVENT_ID, opts.total ?? rows[0]!.total, holdUntil],
      );
      await c.query(
        `INSERT INTO booking_items (id, booking_id, show_seat_id, price)
         SELECT gen_random_uuid(), $1, id, price FROM show_seats WHERE show_id = $2 AND seat_id = ANY($3)`,
        [bookingId, opts.itemsShowId ?? showId, seatIds],
      );
      const { rowCount } = await c.query(
        `UPDATE show_seats SET status = 'HELD', booking_id = $1, hold_expires_at = $4, version = version + 1
          WHERE show_id = $2 AND seat_id = ANY($3) AND status = 'AVAILABLE'`,
        [bookingId, opts.itemsShowId ?? showId, seatIds, opts.seatHoldUntil ?? holdUntil],
      );
      if (rowCount !== seatIds.length) throw new SeatsUnavailable();
      return bookingId;
    });
  } catch (error) {
    if (error instanceof SeatsUnavailable) return null;
    throw error;
  }
}
class SeatsUnavailable extends Error {}

async function bookingTotal(c: Client | pg.Pool, bookingId: string): Promise<string> {
  const { rows } = await c.query<{ total_amount: string }>(`SELECT total_amount FROM bookings WHERE id = $1`, [bookingId]);
  return rows[0]!.total_amount;
}

async function insertPayment(c: Client | pg.Pool, bookingId: string, status = 'CREATED', amount?: string) {
  const id = randomUUID();
  await c.query(
    `INSERT INTO payments (id, booking_id, provider, amount, currency, status, idempotency_key)
     VALUES ($1, $2, 'razorpay', $3, 'INR', $4, $5)`,
    [id, bookingId, amount ?? (await bookingTotal(c, bookingId)), status, `${bookingId}:${randomUUID().slice(0, 8)}`],
  );
  return id;
}

/** The webhook confirm transaction. */
async function confirm(bookingId: string) {
  return tx(async (c) => {
    const paymentId = await insertPayment(c, bookingId);
    await c.query(`UPDATE payments SET status = 'CAPTURED' WHERE id = $1`, [paymentId]);
    await c.query(`UPDATE bookings SET status = 'CONFIRMED', confirmed_at = now() WHERE id = $1`, [bookingId]);
    await c.query(
      `UPDATE show_seats SET status = 'BOOKED', hold_expires_at = NULL, version = version + 1
        WHERE booking_id = $1 AND status = 'HELD'`,
      [bookingId],
    );
    return paymentId;
  });
}

/** The expiry sweeper transaction. */
async function expire(bookingId: string) {
  await tx(async (c) => {
    await c.query(`UPDATE bookings SET status = 'EXPIRED' WHERE id = $1 AND status = 'PENDING'`, [bookingId]);
    await c.query(
      `UPDATE show_seats SET status = 'AVAILABLE', booking_id = NULL, hold_expires_at = NULL, version = version + 1
        WHERE booking_id = $1 AND status = 'HELD'`,
      [bookingId],
    );
  });
}

async function seatRow(seatId: string, showId = SHOW_A) {
  const { rows } = await pool.query(`SELECT status, booking_id, version FROM show_seats WHERE show_id = $1 AND seat_id = $2`, [
    showId,
    seatId,
  ]);
  return rows[0] as { status: string; booking_id: string | null; version: number };
}

beforeAll(async () => {
  ({ container } = await startMigratedPostgres());
  pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 30 });
  userId = randomUUID();
  await pool.query(`INSERT INTO users (id, email, password_hash, name, role) VALUES ($1, 'c@example.com', 'x', 'C', 'CUSTOMER')`, [userId]);
});

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

describe('show_seats row rules', () => {
  it('rejects the same seat twice for one show', async () => {
    const id = await seat();
    await expect(seat({ seat_id: id })).rejects.toThrow(/show_seats_show_id_seat_id_key/);
  });

  it('only creates seats as AVAILABLE or BLOCKED', async () => {
    await seat({ status: 'BLOCKED' });
    await expect(seat({ status: 'HELD' })).rejects.toThrow(/new seats must be AVAILABLE or BLOCKED/);
  });

  it.each([
    ['zero price (free seats are out of scope)', { price: '0.00' }, /show_seats_price_chk/],
    ['upper-case Mongo id', { show_id: 'A'.repeat(24) }, /show_seats_show_id_chk/],
    ['short Mongo id', { event_id: 'abc' }, /show_seats_event_id_chk/],
    ['invalid currency', { currency: 'inr' }, /show_seats_currency_chk/],
  ])('rejects %s', async (_label, overrides, error) => {
    await expect(seat(overrides)).rejects.toThrow(error);
  });

  it.each([
    ['AVAILABLE → BOOKED', 'AVAILABLE', 'BOOKED'],
    ['BLOCKED → HELD', 'BLOCKED', 'HELD'],
  ])('rejects the illegal transition %s', async (_label, from, to) => {
    const id = await seat({ status: from });
    await expect(pool.query(`UPDATE show_seats SET status = $1 WHERE show_id = $2 AND seat_id = $3`, [to, SHOW_A, id])).rejects.toThrow(
      /illegal transition/,
    );
  });

  it('rejects status/ownership mismatches (HELD without a booking)', async () => {
    const id = await seat();
    await expect(
      pool.query(`UPDATE show_seats SET status = 'HELD', hold_expires_at = now() WHERE show_id = $1 AND seat_id = $2`, [SHOW_A, id]),
    ).rejects.toThrow(/show_seats_status_owner_chk/);
  });
});

describe('holding seats', () => {
  it('allows exactly one winner when 200 requests race to hold the same seat', async () => {
    const id = await seat();
    const results = await Promise.all(Array.from({ length: 200 }, () => hold([id])));

    const winners = results.filter((r): r is string => r !== null);
    expect(winners).toHaveLength(1);
    expect(await seatRow(id)).toEqual({ status: 'HELD', booking_id: winners[0], version: 1 });
    // Losers left nothing behind: their bookings were rolled back.
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM booking_items bi JOIN show_seats s ON s.id = bi.show_seat_id
        WHERE s.show_id = $1 AND s.seat_id = $2`,
      [SHOW_A, id],
    );
    expect(rows[0].n).toBe(1);
  });

  it('holds multiple seats all-or-nothing', async () => {
    const [m1, m2] = [await seat(), await seat()];
    expect(await hold([m1])).not.toBeNull();
    expect(await hold([m1, m2])).toBeNull();
    expect((await seatRow(m2)).status).toBe('AVAILABLE');
  });
});

describe('booking consistency (checked at COMMIT)', () => {
  it('rejects a booking whose total differs from the sum of its items', async () => {
    const id = await seat({ price: '350.00' });
    await expect(hold([id], { total: '100.00' })).rejects.toThrow(/total_amount .* <> sum of items/);
  });

  it('rejects a booking that holds seats of another show', async () => {
    const id = await seat({ show_id: SHOW_B });
    await expect(hold([id], { showId: SHOW_A, itemsShowId: SHOW_B })).rejects.toThrow(/another show/);
  });

  it('rejects a seat whose hold expiry differs from the booking (one clock only)', async () => {
    const id = await seat();
    const holdUntil = HOLD_UNTIL();
    await expect(hold([id], { holdUntil, seatHoldUntil: new Date(holdUntil.getTime() + 1000) })).rejects.toThrow(
      /state the booking does not allow/,
    );
  });

  it('rejects a booking with no items', async () => {
    await expect(
      tx((c) =>
        c.query(
          `INSERT INTO bookings (id, booking_ref, user_id, show_id, event_id, total_amount, currency, hold_expires_at)
           VALUES (gen_random_uuid(), 'EMPTY0000001', $1, $2, $3, '1.00', 'INR', now())`,
          [userId, SHOW_A, EVENT_ID],
        ),
      ),
    ).rejects.toThrow(/has no items/);
  });

  it('rejects BOOKED seats without a CAPTURED payment', async () => {
    const id = await seat();
    const bookingId = (await hold([id]))!;
    await expect(
      tx(async (c) => {
        await c.query(`UPDATE bookings SET status = 'CONFIRMED', confirmed_at = now() WHERE id = $1`, [bookingId]);
        await c.query(`UPDATE show_seats SET status = 'BOOKED', hold_expires_at = NULL WHERE booking_id = $1`, [bookingId]);
      }),
    ).rejects.toThrow(/state the booking does not allow/);
  });

  it('rejects expiring a booking while its seats stay HELD', async () => {
    const id = await seat();
    const bookingId = (await hold([id]))!;
    await expect(tx((c) => c.query(`UPDATE bookings SET status = 'EXPIRED' WHERE id = $1`, [bookingId]))).rejects.toThrow(
      /state the booking does not allow/,
    );
  });

  it('rejects BOOKED seats owned by an EXPIRED booking', async () => {
    const id = await seat();
    const bookingId = (await hold([id]))!;
    await expect(
      tx(async (c) => {
        const paymentId = await insertPayment(c, bookingId);
        await c.query(`UPDATE payments SET status = 'CAPTURED' WHERE id = $1`, [paymentId]);
        await c.query(`UPDATE bookings SET status = 'EXPIRED' WHERE id = $1`, [bookingId]);
        await c.query(`UPDATE show_seats SET status = 'BOOKED', hold_expires_at = NULL WHERE booking_id = $1`, [bookingId]);
      }),
    ).rejects.toThrow(/state the booking does not allow/);
  });

  it('accepts the full lifecycle: hold → confirm → cancel with refund', async () => {
    const id = await seat();
    const bookingId = (await hold([id]))!;
    const paymentId = await confirm(bookingId);
    expect(await seatRow(id)).toMatchObject({ status: 'BOOKED', booking_id: bookingId });

    await tx(async (c) => {
      await c.query(
        `INSERT INTO refunds (id, payment_id, amount, reason, status, idempotency_key)
         VALUES (gen_random_uuid(), $1, '350.00', 'customer cancel', 'PROCESSED', $2)`,
        [paymentId, `refund:${paymentId}:full`],
      );
      await c.query(`UPDATE payments SET status = 'REFUNDED' WHERE id = $1`, [paymentId]);
      await c.query(`UPDATE bookings SET status = 'CANCELLED', cancelled_at = now() WHERE id = $1`, [bookingId]);
      await c.query(`UPDATE show_seats SET status = 'AVAILABLE', booking_id = NULL, version = version + 1 WHERE booking_id = $1`, [
        bookingId,
      ]);
    });
    expect((await seatRow(id)).status).toBe('AVAILABLE');
  });

  it('accepts a late payment: EXPIRED booking re-holds its seats and confirms in one transaction', async () => {
    const id = await seat();
    const bookingId = (await hold([id]))!;
    await expire(bookingId);

    await tx(async (c) => {
      const { rows } = await c.query<{ hold_expires_at: Date }>(`SELECT hold_expires_at FROM bookings WHERE id = $1`, [bookingId]);
      const { rowCount } = await c.query(
        `UPDATE show_seats SET status = 'HELD', booking_id = $1, hold_expires_at = $2
          WHERE show_seats.id IN (SELECT show_seat_id FROM booking_items WHERE booking_id = $1) AND status = 'AVAILABLE'`,
        [bookingId, rows[0]!.hold_expires_at],
      );
      expect(rowCount).toBe(1);
      const paymentId = await insertPayment(c, bookingId);
      await c.query(`UPDATE payments SET status = 'CAPTURED' WHERE id = $1`, [paymentId]);
      await c.query(`UPDATE bookings SET status = 'CONFIRMED', confirmed_at = now() WHERE id = $1`, [bookingId]);
      await c.query(`UPDATE show_seats SET status = 'BOOKED', hold_expires_at = NULL WHERE booking_id = $1`, [bookingId]);
    });
    expect(await seatRow(id)).toMatchObject({ status: 'BOOKED', booking_id: bookingId });
  });
});

describe('booking status transitions', () => {
  it('creates bookings only as PENDING', async () => {
    const id = await seat();
    await expect(
      tx(async (c) => {
        await c.query(
          `INSERT INTO bookings (id, booking_ref, user_id, show_id, event_id, status, total_amount, currency, hold_expires_at, confirmed_at)
           VALUES (gen_random_uuid(), 'CONF00000001', $1, $2, $3, 'CONFIRMED', '350.00', 'INR', now(), now())`,
          [userId, SHOW_A, EVENT_ID],
        );
        void id;
      }),
    ).rejects.toThrow(/new bookings must be PENDING/);
  });

  it.each([
    ['CONFIRMED → PENDING', 'PENDING'],
    ['CONFIRMED → EXPIRED', 'EXPIRED'],
  ])('rejects %s', async (_label, to) => {
    const bookingId = (await hold([await seat()]))!;
    await confirm(bookingId);
    await expect(pool.query(`UPDATE bookings SET status = $1 WHERE id = $2`, [to, bookingId])).rejects.toThrow(/illegal transition/);
  });

  it('dedupes creation by (user, idempotency key)', async () => {
    const insert = (c: Client, seatId: string) =>
      c.query(
        `WITH b AS (
           INSERT INTO bookings (id, booking_ref, user_id, show_id, event_id, total_amount, currency, hold_expires_at, idempotency_key)
           VALUES (gen_random_uuid(), substr(md5(random()::text), 1, 12), $1, $2, $3, '350.00', 'INR', now(), 'key-1') RETURNING id)
         INSERT INTO booking_items (id, booking_id, show_seat_id, price)
         SELECT gen_random_uuid(), b.id, s.id, s.price FROM b, show_seats s WHERE s.show_id = $2 AND s.seat_id = $4`,
        [userId, SHOW_A, EVENT_ID, seatId],
      );
    const [s1, s2] = [await seat(), await seat()];
    await tx((c) => insert(c, s1));
    await expect(tx((c) => insert(c, s2))).rejects.toThrow(/bookings_user_id_idempotency_key_key/);
  });
});

describe('payments', () => {
  it('must match the booking total and currency', async () => {
    const bookingId = (await hold([await seat()]))!;
    await expect(insertPayment(pool, bookingId, 'CREATED', '1.00')).rejects.toThrow(/does not match booking total/);
  });

  it('allows one CAPTURED payment per booking; a second capture is recorded as CAPTURED_DUPLICATE', async () => {
    const bookingId = (await hold([await seat()]))!;
    await confirm(bookingId);
    await expect(insertPayment(pool, bookingId, 'CAPTURED')).rejects.toThrow(/payments_one_captured_per_booking_idx/);
    await insertPayment(pool, bookingId, 'CAPTURED_DUPLICATE');
  });
});

describe('refunds', () => {
  const refund = (paymentId: string, amount: string) =>
    pool.query(`INSERT INTO refunds (id, payment_id, amount, reason, idempotency_key) VALUES (gen_random_uuid(), $1, $2, 'r', $3)`, [
      paymentId,
      amount,
      randomUUID(),
    ]);

  it('only refunds captured money', async () => {
    const bookingId = (await hold([await seat()]))!;
    const paymentId = await insertPayment(pool, bookingId, 'CREATED');
    await expect(refund(paymentId, '1.00')).rejects.toThrow(/only captured payments can be refunded/);
  });

  it('never refunds more than was captured, even under concurrency', async () => {
    const bookingId = (await hold([await seat({ price: '350.00' })]))!;
    const paymentId = await confirm(bookingId);

    const results = await Promise.allSettled(Array.from({ length: 10 }, () => refund(paymentId, '350.00')));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    await expect(refund(paymentId, '0.01')).rejects.toThrow(/exceeds payment amount/);
  });

  it('can refund a CAPTURED_DUPLICATE payment', async () => {
    const bookingId = (await hold([await seat()]))!;
    await confirm(bookingId);
    const duplicateId = await insertPayment(pool, bookingId, 'CAPTURED_DUPLICATE');
    await refund(duplicateId, '350.00');
  });
});

describe('users', () => {
  const insertUser = (email: string, role = 'CUSTOMER') =>
    pool.query(`INSERT INTO users (id, email, password_hash, name, role) VALUES ($1, $2, 'x', 'N', $3)`, [randomUUID(), email, role]);

  it('stores emails lower-cased only', async () => {
    await expect(insertUser('Mixed@Example.com')).rejects.toThrow(/users_email_lowercase_chk/);
  });

  it('allows the same email once per role', async () => {
    await insertUser('both@example.com', 'CUSTOMER');
    await insertUser('both@example.com', 'MANAGER');
    await expect(insertUser('both@example.com', 'MANAGER')).rejects.toThrow(/users_email_role_key/);
  });
});
