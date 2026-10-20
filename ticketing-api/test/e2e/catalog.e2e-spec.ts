/**
 * Phase 2 & 3 exit criteria: the manager catalog lifecycle (venues, versioned
 * layouts, events, shows) and public browsing with filters.
 */
import { randomUUID } from 'node:crypto';
import { API, createOnSaleShow, createUser, resetRateLimits, startApp, type TestApp } from './support/app.js';

let t: TestApp;
let m: Awaited<ReturnType<typeof createUser>>;

beforeAll(async () => {
  t = await startApp();
  m = await createUser(t, 'MANAGER');
});
afterAll(async () => {
  await t?.close();
});
beforeEach(async () => {
  await resetRateLimits(t);
});

const layout = (rows: Array<[string, string, number]>) => ({
  sections: rows.map(([code, label, count], y) => ({
    code,
    name: code,
    priceTier: code,
    rows: [{ label, seats: Array.from({ length: count }, (_, i) => ({ id: `${label}${i + 1}`, number: i + 1, x: i, y })) }],
  })),
});

const inDays = (days: number, hours = 0) => new Date(Date.now() + days * 86_400_000 + hours * 3600_000).toISOString();

async function venueWithLayout(city = 'surat') {
  const venue = await t.http
    .post(`${API}/manager/venues`)
    .set(m.auth)
    .send({
      name: 'Catalog Venue',
      city,
      address: { line1: 'a', state: 'GJ', postalCode: '395001' },
      geo: { lng: 72.83, lat: 21.17 },
      halls: [{ hallId: 'h1', name: 'Hall 1' }],
    })
    .expect(201);
  await t.http
    .put(`${API}/manager/venues/${venue.body.id as string}/halls/h1/layout`)
    .set(m.auth)
    .send(layout([['GOLD', 'A', 4]]))
    .expect(200);
  return venue.body as { id: string };
}

async function draftEvent(title = `Catalog ${randomUUID().slice(0, 6)}`) {
  return (
    await t.http
      .post(`${API}/manager/events`)
      .set(m.auth)
      .send({ title, description: 'd', category: 'PLAY', durationMins: 60, genres: ['Drama'] })
      .expect(201)
  ).body as { id: string; slug: string };
}

describe('venues and layouts', () => {
  it('creates, lists, reads and updates venues', async () => {
    const venue = await venueWithLayout();
    const list = await t.http.get(`${API}/manager/venues?limit=100`).set(m.auth).expect(200);
    expect(list.body.data.map((v: { id: string }) => v.id)).toContain(venue.id);
    const read = await t.http.get(`${API}/manager/venues/${venue.id}`).set(m.auth).expect(200);
    expect(read.body).toMatchObject({
      city: 'surat',
      location: { lng: 72.83, lat: 21.17 },
      halls: [{ hallId: 'h1', layoutId: expect.any(String) }],
    });

    const updated = await t.http
      .patch(`${API}/manager/venues/${venue.id}`)
      .set(m.auth)
      .send({ name: 'Renamed', status: 'INACTIVE' })
      .expect(200);
    expect(updated.body).toMatchObject({ name: 'Renamed', status: 'INACTIVE' });
    await t.http.patch(`${API}/manager/venues/${venue.id}`).set(m.auth).send({}).expect(400);
  });

  it('adds halls and rejects duplicates', async () => {
    const venue = await venueWithLayout();
    await t.http.post(`${API}/manager/venues/${venue.id}/halls`).set(m.auth).send({ hallId: 'h2', name: 'Hall 2' }).expect(201);
    expect(
      (await t.http.post(`${API}/manager/venues/${venue.id}/halls`).set(m.auth).send({ hallId: 'h2', name: 'Again' }).expect(409)).body
        .error.code,
    ).toBe('HALL_EXISTS');
  });

  it('versions layouts — every save is a new immutable version', async () => {
    const venue = await venueWithLayout();
    const v2 = await t.http
      .put(`${API}/manager/venues/${venue.id}/halls/h1/layout`)
      .set(m.auth)
      .send(
        layout([
          ['GOLD', 'A', 2],
          ['SILVER', 'B', 3],
        ]),
      )
      .expect(200);
    expect(v2.body).toMatchObject({ version: 2, totalSeats: 5 });
    const current = await t.http.get(`${API}/manager/venues/${venue.id}/halls/h1/layout`).set(m.auth).expect(200);
    expect(current.body.version).toBe(2);
    await t.http
      .put(`${API}/manager/venues/${venue.id}/halls/nope/layout`)
      .set(m.auth)
      .send(layout([['GOLD', 'A', 1]]))
      .expect(404);
    expect(
      (await t.http.put(`${API}/manager/venues/${venue.id}/halls/h1/layout`).set(m.auth).send({ sections: [] }).expect(400)).body.error
        .code,
    ).toBe('VALIDATION_FAILED');
  });

  it('reports a hall without a layout', async () => {
    const venue = await venueWithLayout();
    await t.http.post(`${API}/manager/venues/${venue.id}/halls`).set(m.auth).send({ hallId: 'bare', name: 'Bare' }).expect(201);
    await t.http.get(`${API}/manager/venues/${venue.id}/halls/bare/layout`).set(m.auth).expect(404);
    const event = await draftEvent();
    const res = await t.http
      .post(`${API}/manager/shows`)
      .set(m.auth)
      .send({ eventId: event.id, venueId: venue.id, hallId: 'bare', startsAt: inDays(5), endsAt: inDays(5, 2), pricing: { GOLD: 100 } })
      .expect(409);
    expect(res.body.error.code).toBe('HALL_HAS_NO_LAYOUT');
  });
});

describe('events', () => {
  it('creates drafts with unique slugs, updates and publishes once', async () => {
    const title = `Same Title ${randomUUID().slice(0, 6)}`;
    const a = await draftEvent(title);
    const b = await draftEvent(title);
    expect(a.slug).not.toBe(b.slug);
    expect(b.slug.startsWith(a.slug)).toBe(true);

    const list = await t.http.get(`${API}/manager/events?limit=100`).set(m.auth).expect(200);
    expect(list.body.data.map((e: { id: string }) => e.id)).toEqual(expect.arrayContaining([a.id, b.id]));
    expect((await t.http.get(`${API}/manager/events/${a.id}`).set(m.auth).expect(200)).body.status).toBe('DRAFT');

    const updated = await t.http
      .patch(`${API}/manager/events/${a.id}`)
      .set(m.auth)
      .send({ durationMins: 75, posterUrl: 'https://cdn.example/p.jpg' })
      .expect(200);
    expect(updated.body).toMatchObject({ durationMins: 75, posterUrl: 'https://cdn.example/p.jpg', genres: ['drama'] });
    await t.http.patch(`${API}/manager/events/${a.id}`).set(m.auth).send({ posterUrl: 'http://insecure.example/p.jpg' }).expect(400);

    await t.http.post(`${API}/manager/events/${a.id}/publish`).set(m.auth).expect(200);
    expect((await t.http.post(`${API}/manager/events/${a.id}/publish`).set(m.auth).expect(409)).body.error.code).toBe('EVENT_NOT_DRAFT');
  });
});

describe('shows', () => {
  it('schedules, lists, edits and publishes shows with all rules enforced', async () => {
    const venue = await venueWithLayout();
    const event = await draftEvent();
    const base = { eventId: event.id, venueId: venue.id, hallId: 'h1', pricing: { GOLD: 25000 } };

    expect(
      (
        await t.http
          .post(`${API}/manager/shows`)
          .set(m.auth)
          .send({ ...base, startsAt: inDays(-1), endsAt: inDays(0) })
          .expect(400)
      ).body.error.code,
    ).toBe('SHOW_IN_PAST');
    expect(
      (
        await t.http
          .post(`${API}/manager/shows`)
          .set(m.auth)
          .send({ ...base, startsAt: inDays(5, 2), endsAt: inDays(5) })
          .expect(400)
      ).body.error.code,
    ).toBe('INVALID_SHOW_TIMES');
    expect(
      (
        await t.http
          .post(`${API}/manager/shows`)
          .set(m.auth)
          .send({ ...base, startsAt: inDays(5), endsAt: inDays(5, 2), salesOpenAt: inDays(6) })
          .expect(400)
      ).body.error.code,
    ).toBe('INVALID_SHOW_TIMES');

    const show = (
      await t.http
        .post(`${API}/manager/shows`)
        .set(m.auth)
        .send({ ...base, startsAt: inDays(5), endsAt: inDays(5, 2) })
        .expect(201)
    ).body as { id: string };
    const later = (
      await t.http
        .post(`${API}/manager/shows`)
        .set(m.auth)
        .send({ ...base, startsAt: inDays(6), endsAt: inDays(6, 2) })
        .expect(201)
    ).body as { id: string };

    const list = await t.http.get(`${API}/manager/shows?eventId=${event.id}&status=SCHEDULED`).set(m.auth).expect(200);
    expect(list.body.meta.total).toBe(2);
    expect((await t.http.get(`${API}/manager/shows/${show.id}`).set(m.auth).expect(200)).body).toMatchObject({
      status: 'SCHEDULED',
      pricing: { GOLD: '250.00' },
    });

    // Moving `later` onto `show`'s slot clashes; changing price works; pricing must match tiers.
    expect(
      (
        await t.http
          .patch(`${API}/manager/shows/${later.id}`)
          .set(m.auth)
          .send({ startsAt: inDays(5, 1), endsAt: inDays(5, 3) })
          .expect(409)
      ).body.error.code,
    ).toBe('HALL_BUSY');
    expect(
      (
        await t.http
          .patch(`${API}/manager/shows/${show.id}`)
          .set(m.auth)
          .send({ pricing: { GOLD: 30000 } })
          .expect(200)
      ).body.pricing,
    ).toEqual({ GOLD: '300.00' });
    expect(
      (
        await t.http
          .patch(`${API}/manager/shows/${show.id}`)
          .set(m.auth)
          .send({ pricing: { PLATINUM: 1 } })
          .expect(400)
      ).body.error.code,
    ).toBe('PRICING_MISMATCH');

    expect((await t.http.post(`${API}/manager/shows/${show.id}/publish`).set(m.auth).expect(409)).body.error.code).toBe(
      'EVENT_NOT_PUBLISHED',
    );
    await t.http.post(`${API}/manager/events/${event.id}/publish`).set(m.auth).expect(200);
    const published = await t.http.post(`${API}/manager/shows/${show.id}/publish`).set(m.auth).expect(200);
    expect(published.body).toMatchObject({ status: 'ON_SALE', totalSeats: 4 });
    expect((await t.http.post(`${API}/manager/shows/${show.id}/publish`).set(m.auth).expect(409)).body.error.code).toBe(
      'SHOW_NOT_SCHEDULED',
    );
    expect(
      (
        await t.http
          .patch(`${API}/manager/shows/${show.id}`)
          .set(m.auth)
          .send({ pricing: { GOLD: 1 } })
          .expect(409)
      ).body.error.code,
    ).toBe('SHOW_NOT_EDITABLE');

    // Seats can be unblocked again.
    await t.http
      .post(`${API}/manager/shows/${show.id}/seats/block`)
      .set(m.auth)
      .send({ seatIds: ['A1'] })
      .expect(200);
    expect(
      (
        await t.http
          .post(`${API}/manager/shows/${show.id}/seats/unblock`)
          .set(m.auth)
          .send({ seatIds: ['A1'] })
          .expect(200)
      ).body.changed,
    ).toEqual(['A1']);
  });

  it('rejects shows for inactive venues', async () => {
    const venue = await venueWithLayout();
    const event = await draftEvent();
    await t.http.patch(`${API}/manager/venues/${venue.id}`).set(m.auth).send({ status: 'INACTIVE' }).expect(200);
    const res = await t.http
      .post(`${API}/manager/shows`)
      .set(m.auth)
      .send({ eventId: event.id, venueId: venue.id, hallId: 'h1', startsAt: inDays(5), endsAt: inDays(5, 2), pricing: { GOLD: 1 } })
      .expect(409);
    expect(res.body.error.code).toBe('VENUE_INACTIVE');
  });
});

describe('public catalog', () => {
  it('finds events by slug, text, category, city and date', async () => {
    const { eventId, showId } = await createOnSaleShow(t, m, { city: 'indore', startsInHours: 48 });
    const event = await t.http.get(`${API}/events/${eventId}`).expect(200);
    expect((await t.http.get(`${API}/events/${event.body.slug as string}`).expect(200)).body.id).toBe(eventId);
    await t.http.get(`${API}/events/Not A Slug!`).expect(404);
    await t.http.get(`${API}/events/${'f'.repeat(24)}`).expect(404);

    const showDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() + 48 * 3600_000));
    const byDate = await t.http.get(`${API}/events?city=indore&date=${showDate}`).expect(200);
    expect(byDate.body.data.map((e: { id: string }) => e.id)).toContain(eventId);
    expect((await t.http.get(`${API}/events?city=indore&date=2020-01-01`).expect(200)).body.data).toEqual([]);
    expect((await t.http.get(`${API}/events?city=indore&category=SPORTS`).expect(200)).body.data).toEqual([]);
    const text = await t.http.get(`${API}/events?q=${encodeURIComponent(event.body.title as string)}`).expect(200);
    expect(text.body.data[0].id).toBe(eventId);

    const shows = await t.http.get(`${API}/events/${eventId}/shows?city=indore&date=${showDate}`).expect(200);
    expect(shows.body).toMatchObject([{ id: showId, venue: { hallName: 'Hall 1' } }]);
    expect((await t.http.get(`${API}/events/${eventId}/shows?city=elsewhere`).expect(200)).body).toEqual([]);
    expect((await t.http.get(`${API}/events/${eventId}/shows?date=2020-01-01`).expect(200)).body).toEqual([]);

    const detail = await t.http.get(`${API}/shows/${showId}`).expect(200);
    expect(detail.body).toMatchObject({ event: { id: eventId }, venue: { city: 'indore', hallName: 'Hall 1' } });
    await t.http.get(`${API}/shows/${'e'.repeat(24)}`).expect(404);
    await t.http.get(`${API}/shows/${'e'.repeat(24)}/seats`).expect(404);
  });

  it('hides draft events and scheduled shows', async () => {
    const venue = await venueWithLayout('bhopal');
    const event = await draftEvent();
    const show = await t.http
      .post(`${API}/manager/shows`)
      .set(m.auth)
      .send({ eventId: event.id, venueId: venue.id, hallId: 'h1', startsAt: inDays(4), endsAt: inDays(4, 2), pricing: { GOLD: 1 } })
      .expect(201);
    await t.http.get(`${API}/events/${event.id}`).expect(404);
    await t.http.get(`${API}/shows/${show.body.id as string}`).expect(404);
    expect((await t.http.get(`${API}/events?city=bhopal`).expect(200)).body.data).toEqual([]);
  });

  it('serves the OpenAPI document for the web client', async () => {
    const doc = await t.http.get('/api/docs-json').expect(200);
    expect(Object.keys(doc.body.paths)).toEqual(
      expect.arrayContaining(['/api/v1/bookings/hold', '/api/v1/manager/shows/{id}/publish', '/api/v1/events']),
    );
  });
});
