import mongoose, { Types } from 'mongoose';
import { SeatLayoutSchema, sellableSeats, type LayoutSection } from './seat-layout.schema.js';
import { EventSchema } from './event.schema.js';
import { ShowSchema } from './show.schema.js';
import { VenueSchema } from './venue.schema.js';

// Validation runs in-process; no database connection is needed.
const SeatLayout = mongoose.model('SeatLayoutSpec', SeatLayoutSchema);
const Show = mongoose.model('ShowSpec', ShowSchema);
const Venue = mongoose.model('VenueSpec', VenueSchema);
const Event = mongoose.model('EventSpec', EventSchema);

const section = (code: string, seats: Array<[string, number, number, 'REGULAR' | 'GAP']>): LayoutSection => ({
  code,
  name: code,
  priceTier: code,
  rows: [{ label: 'A', seats: seats.map(([id, x, y, type]) => ({ id, number: x + 1, x, y, type })) }],
});

describe('SeatLayout schema', () => {
  const base = { venueId: new Types.ObjectId(), hallId: 'audi-1', version: 1 };

  it('computes totalSeats from sellable seats only (GAP excluded)', async () => {
    const layout = new SeatLayout({
      ...base,
      sections: [
        section('GOLD', [
          ['A1', 0, 0, 'REGULAR'],
          ['A-GAP', 1, 0, 'GAP'],
          ['A2', 2, 0, 'REGULAR'],
        ]),
      ],
      totalSeats: 999, // client-supplied value must be overwritten
    });
    await layout.validate();
    expect(layout.totalSeats).toBe(2);
  });

  it('rejects duplicate seat ids across sections', async () => {
    const layout = new SeatLayout({
      ...base,
      sections: [section('GOLD', [['A1', 0, 0, 'REGULAR']]), section('SILVER', [['A1', 1, 0, 'REGULAR']])],
    });
    await expect(layout.validate()).rejects.toThrow(/duplicate seat id "A1"/);
  });

  it('rejects duplicate section codes', async () => {
    const layout = new SeatLayout({
      ...base,
      sections: [section('GOLD', [['A1', 0, 0, 'REGULAR']]), section('GOLD', [['A2', 1, 0, 'REGULAR']])],
    });
    await expect(layout.validate()).rejects.toThrow(/duplicate section code/);
  });

  it('rejects two seats on the same grid position', async () => {
    const layout = new SeatLayout({
      ...base,
      sections: [
        section('GOLD', [
          ['A1', 0, 0, 'REGULAR'],
          ['A2', 0, 0, 'REGULAR'],
        ]),
      ],
    });
    await expect(layout.validate()).rejects.toThrow(/share grid position/);
  });

  it('rejects a layout with no sellable seats', async () => {
    const layout = new SeatLayout({ ...base, sections: [section('GOLD', [['A-GAP', 0, 0, 'GAP']])] });
    await expect(layout.validate()).rejects.toThrow(/at least one sellable seat/);
  });

  it('rejects malformed seat ids', async () => {
    const layout = new SeatLayout({ ...base, sections: [section('GOLD', [['a1; DROP', 0, 0, 'REGULAR']])] });
    await expect(layout.validate()).rejects.toThrow();
  });

  it('flattens sellable seats with their section and price tier', () => {
    const seats = sellableSeats({
      sections: [
        section('GOLD', [
          ['A1', 0, 0, 'REGULAR'],
          ['A-GAP', 1, 0, 'GAP'],
        ]),
      ],
    });
    expect(seats).toEqual([{ seatId: 'A1', section: 'GOLD', rowLabel: 'A', seatNumber: 1, priceTier: 'GOLD' }]);
  });
});

describe('Show schema', () => {
  const startsAt = new Date('2026-12-01T13:30:00Z');
  const base = {
    eventId: new Types.ObjectId(),
    managerId: '0199c3c0-0000-7000-8000-000000000001',
    venueId: new Types.ObjectId(),
    hallId: 'audi-1',
    layoutId: new Types.ObjectId(),
    layoutVersion: 1,
    city: 'bengaluru',
    startsAt,
    endsAt: new Date(startsAt.getTime() + 3 * 3600_000),
    salesOpenAt: new Date(startsAt.getTime() - 7 * 86400_000),
    pricing: { GOLD: 35000 },
  };

  it('accepts a valid show', async () => {
    await expect(new Show(base).validate()).resolves.toBeUndefined();
  });

  it('rejects endsAt before startsAt', async () => {
    await expect(new Show({ ...base, endsAt: startsAt }).validate()).rejects.toThrow(/endsAt must be after/);
  });

  it('rejects sales opening after the show starts', async () => {
    await expect(new Show({ ...base, salesOpenAt: startsAt }).validate()).rejects.toThrow(/salesOpenAt/);
  });

  it.each([{ GOLD: 350.5 }, { GOLD: -1 }, { GOLD: 0 }, {}])('rejects non-integer, non-positive or empty pricing %o', async (pricing) => {
    await expect(new Show({ ...base, pricing }).validate()).rejects.toThrow(/pricing/);
  });
});

describe('Venue schema', () => {
  const base = {
    managerId: '0199c3c0-0000-7000-8000-000000000001',
    name: 'Demo',
    city: 'Bengaluru',
    address: { line1: 'x', state: 'KA', postalCode: '560001' },
  };

  it('normalizes city to lower case', async () => {
    const venue = new Venue(base);
    await venue.validate();
    expect(venue.city).toBe('bengaluru');
  });

  it('rejects duplicate hall ids', async () => {
    const venue = new Venue({
      ...base,
      halls: [
        { hallId: 'a', name: 'A' },
        { hallId: 'a', name: 'B' },
      ],
    });
    await expect(venue.validate()).rejects.toThrow(/hallId must be unique/);
  });

  it('rejects a managerId that is not a users.id UUID', async () => {
    await expect(new Venue({ ...base, managerId: 'not-a-uuid' }).validate()).rejects.toThrow(/managerId/);
  });

  it.each([[[200, 12]], [[77, -91]], [[77]], [[77, 12, 3]]])('rejects invalid coordinates %j', async (coordinates) => {
    const venue = new Venue({ ...base, geo: { type: 'Point', coordinates } });
    await expect(venue.validate()).rejects.toThrow(/coordinates/);
  });

  it('accepts valid [lng, lat] coordinates', async () => {
    await expect(new Venue({ ...base, geo: { type: 'Point', coordinates: [77.69, 12.99] } }).validate()).resolves.toBeUndefined();
  });

  it('rejects more than 50 halls', async () => {
    const halls = Array.from({ length: 51 }, (_, i) => ({ hallId: `h-${i}`, name: `H${i}` }));
    await expect(new Venue({ ...base, halls }).validate()).rejects.toThrow(/max 50 halls/);
  });
});

describe('Event schema', () => {
  const base = {
    managerId: '0199c3c0-0000-7000-8000-000000000001',
    title: 'Interstellar',
    slug: 'interstellar',
    description: 'd',
    category: 'MOVIE',
    durationMins: 169,
  };

  it('defaults new events to DRAFT', async () => {
    const event = new Event(base);
    await event.validate();
    expect(event.status).toBe('DRAFT');
  });

  it.each(['Has Spaces', 'trailing-', '-leading', 'double--dash', 'UPPER_case'])('rejects slug "%s"', async (slug) => {
    await expect(new Event({ ...base, slug }).validate()).rejects.toThrow(/slug/);
  });

  it('rejects non-https media URLs', async () => {
    await expect(new Event({ ...base, posterUrl: 'http://cdn.example/p.jpg' }).validate()).rejects.toThrow(/posterUrl/);
    await expect(new Event({ ...base, posterUrl: 'javascript:alert(1)' }).validate()).rejects.toThrow(/posterUrl/);
  });

  it('caps array sizes (genres ≤ 10)', async () => {
    const genres = Array.from({ length: 11 }, (_, i) => `g${i}`);
    await expect(new Event({ ...base, genres }).validate()).rejects.toThrow(/at most 10/);
  });

  it('rejects unknown categories', async () => {
    await expect(new Event({ ...base, category: 'CIRCUS' }).validate()).rejects.toThrow(/category/);
  });
});

describe('catalog DTOs', () => {
  it('PATCH schemas never inject defaults for absent fields', async () => {
    const { UpdateEventSchema, UpdateVenueSchema, UpdateShowSchema } = await import('../dto/catalog.dto.js');
    expect(UpdateEventSchema.parse({ durationMins: 75 })).toEqual({ durationMins: 75 });
    expect(UpdateVenueSchema.parse({ name: 'x' })).toEqual({ name: 'x' });
    expect(UpdateShowSchema.parse({ pricing: { GOLD: 1 } })).toEqual({ pricing: { GOLD: 1 } });
  });
});
