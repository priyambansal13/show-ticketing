/**
 * Catalog indexes and constraints on a real MongoDB (replica set).
 */
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import mongoose, { Types } from 'mongoose';
import { EventSchema, type Event as CatalogEvent } from '../../src/modules/events/schemas/event.schema.js';
import { SeatLayoutSchema } from '../../src/modules/events/schemas/seat-layout.schema.js';
import { ShowSchema } from '../../src/modules/events/schemas/show.schema.js';
import { VenueSchema } from '../../src/modules/events/schemas/venue.schema.js';
import { applyMongooseSecurityDefaults } from '../../src/infra/mongo/mongoose-defaults.js';

let container: StartedMongoDBContainer;
let connection: mongoose.Connection;

const managerId = '0199c3c0-0000-7000-8000-000000000001';

beforeAll(async () => {
  applyMongooseSecurityDefaults();
  container = await new MongoDBContainer('mongo:8.0').start();
  connection = await mongoose.createConnection(`${container.getConnectionString()}/catalog?directConnection=true`).asPromise();
  for (const [name, schema] of [
    ['Venue', VenueSchema],
    ['SeatLayout', SeatLayoutSchema],
    ['Event', EventSchema],
    ['Show', ShowSchema],
  ] as const) {
    await connection.model(name, schema as mongoose.Schema).init();
  }
});

afterAll(async () => {
  await connection?.close();
  await container?.stop();
});

const event = (slug: string, title = 'A Movie'): Partial<CatalogEvent> => ({
  managerId,
  title,
  slug,
  description: 'd',
  category: 'MOVIE',
  durationMins: 120,
  genres: ['drama'],
  status: 'PUBLISHED',
});

describe('events', () => {
  it('enforces a unique slug', async () => {
    const Event = connection.model<CatalogEvent>('Event');
    await Event.create(event('unique-slug'));
    await expect(Event.create(event('unique-slug'))).rejects.toThrow(/E11000/);
  });

  it('finds events by full-text search on title and genres', async () => {
    const Event = connection.model<CatalogEvent>('Event');
    await Event.create(event('interstellar', 'Interstellar'));
    await Event.create({ ...event('cosmic-comedy', 'Cosmic Laughs'), genres: ['comedy'] });

    // Server-built operators must be explicitly trusted; request data never is.
    const byTitle = await Event.find({ $text: mongoose.trusted({ $search: 'interstellar' }) }).lean();
    expect(byTitle.map((e) => e.slug)).toEqual(['interstellar']);

    const byGenre = await Event.find({ $text: mongoose.trusted({ $search: 'comedy' }) }).lean();
    expect(byGenre.map((e) => e.slug)).toEqual(['cosmic-comedy']);
  });

  it('neutralizes query-operator injection in filters (sanitizeFilter)', async () => {
    const Event = connection.model<CatalogEvent>('Event');
    expect(await Event.countDocuments()).toBeGreaterThan(0);
    // A malicious client sends {"slug": {"$ne": null}} hoping to match every document.
    // Sanitized, it becomes {"slug": {"$eq": {"$ne": null}}}, which fails to cast — never a match-all.
    // Typed as string the way an unvalidated request field would arrive at runtime.
    const malicious = JSON.parse('{"$ne": null}') as string;
    await expect(Event.find({ slug: malicious }).lean()).rejects.toThrow(/Cast to string failed/);
  });

  it('refuses untrusted $text (it could only come from request data)', async () => {
    const Event = connection.model<CatalogEvent>('Event');
    await expect(Event.find({ $text: { $search: 'x' } }).lean()).rejects.toThrow(/not allowed with sanitizeFilter/);
  });

  it('drops filter paths that are not in the schema (strictQuery)', async () => {
    const Event = connection.model<CatalogEvent>('Event');
    const all = await Event.countDocuments();
    // Cast: deliberately querying a path the schema does not declare.
    expect(await Event.countDocuments({ notAField: 'x' } as Record<string, unknown>)).toBe(all);
  });
});

describe('seat layouts', () => {
  it('allows one document per (venue, hall, version)', async () => {
    const SeatLayout = connection.model('SeatLayout');
    const doc = {
      venueId: new Types.ObjectId(),
      hallId: 'audi-1',
      version: 1,
      sections: [{ code: 'GOLD', name: 'Gold', priceTier: 'GOLD', rows: [{ label: 'A', seats: [{ id: 'A1', number: 1, x: 0, y: 0 }] }] }],
    };
    await SeatLayout.create(doc);
    await expect(SeatLayout.create(doc)).rejects.toThrow(/E11000/);
    await SeatLayout.create({ ...doc, version: 2 });
  });
});

describe('cross-field rules cannot be bypassed by query updates', () => {
  it('rejects updateOne / findOneAndUpdate on show times and layout sections', async () => {
    const Show = connection.model('Show');
    const SeatLayout = connection.model('SeatLayout');
    await expect(Show.updateOne({}, { $set: { startsAt: new Date() } })).rejects.toThrow(/via document.save\(\)/);
    await expect(Show.findOneAndUpdate({}, { endsAt: new Date() })).rejects.toThrow(/via document.save\(\)/);
    await expect(SeatLayout.updateMany({}, { $push: { sections: {} } })).rejects.toThrow(/via document.save\(\)/);
    // Fields without cross-field rules can still be updated in place.
    await expect(Show.updateOne({}, { $set: { status: 'CANCELLED' } })).resolves.toBeDefined();
  });
});

describe('indexes', () => {
  it('creates the query indexes the plan relies on', async () => {
    const names = async (model: string) => (await connection.model(model).listIndexes()).map((index) => JSON.stringify(index.key));

    expect(await names('Show')).toEqual(
      expect.arrayContaining([JSON.stringify({ city: 1, status: 1, startsAt: 1 }), JSON.stringify({ eventId: 1, startsAt: 1 })]),
    );
    expect(await names('Venue')).toEqual(expect.arrayContaining([JSON.stringify({ geo: '2dsphere' })]));
  });
});
