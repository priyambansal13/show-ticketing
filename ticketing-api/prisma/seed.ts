/**
 * Development seed: three accounts (admin, manager, customer) and one sample
 * venue → layout → event → on-sale show, with its show_seats materialized.
 * Idempotent — safe to run repeatedly. Fails closed: requires NODE_ENV=development|test
 * and a local database host unless SEED_ALLOW_REMOTE=true.
 *
 *   pnpm db:seed
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import argon2 from 'argon2';
import mongoose, { type Types } from 'mongoose';
import { z } from 'zod';
import { minorToDecimalString } from '../src/common/money.js';
import { PrismaClient, type Prisma, type Role } from '../src/generated/prisma/client.js';
import { EventSchema } from '../src/modules/events/schemas/event.schema.js';
import { SeatLayoutSchema, sellableSeats, type LayoutRow } from '../src/modules/events/schemas/seat-layout.schema.js';
import { ShowSchema } from '../src/modules/events/schemas/show.schema.js';
import { VenueSchema } from '../src/modules/events/schemas/venue.schema.js';
import { applyMongooseSecurityDefaults } from '../src/infra/mongo/mongoose-defaults.js';

const env = z
  .object({
    NODE_ENV: z.enum(['development', 'test']),
    SEED_ALLOW_REMOTE: z.literal('true').optional(),
    DATABASE_URL: z.string().min(1),
    MONGO_URL: z.string().min(1),
    SEED_ADMIN_EMAIL: z.email(),
    SEED_ADMIN_PASSWORD: z.string().min(10),
    SEED_MANAGER_EMAIL: z.email(),
    SEED_MANAGER_PASSWORD: z.string().min(10),
    SEED_CUSTOMER_EMAIL: z.email(),
    SEED_CUSTOMER_PASSWORD: z.string().min(10),
  })
  .safeParse(process.env);

if (!env.success) {
  // Missing/invalid NODE_ENV lands here too: the seed never runs on an unspecified environment.
  throw new Error(`Refusing to seed: ${env.error.issues.map((i) => i.path.join('.')).join(', ')} invalid`);
}
const config = env.data;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
for (const url of [config.DATABASE_URL, config.MONGO_URL]) {
  const host = new URL(url).hostname;
  if (!LOCAL_HOSTS.has(host) && config.SEED_ALLOW_REMOTE !== 'true') {
    throw new Error(`Refusing to seed non-local host "${host}" (set SEED_ALLOW_REMOTE=true to override)`);
  }
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: config.DATABASE_URL }) });

async function upsertUser(email: string, password: string, role: Role, name: string) {
  const normalized = email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email_role: { email: normalized, role } } });
  if (existing) return existing;
  return prisma.user.create({
    data: {
      email: normalized,
      role,
      name,
      status: 'ACTIVE',
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
    },
  });
}

/** Rows of `count` seats with an aisle (GAP) after seat `aisleAfter`. */
function buildRows(labels: string[], count: number, aisleAfter: number, startY: number): LayoutRow[] {
  return labels.map((label, rowIndex) => {
    const seats: LayoutRow['seats'] = [];
    let x = 0;
    for (let number = 1; number <= count; number++) {
      seats.push({ id: `${label}${number}`, number, x, y: startY + rowIndex, type: 'REGULAR' });
      x++;
      if (number === aisleAfter) {
        seats.push({ id: `${label}-GAP`, number: number, x, y: startY + rowIndex, type: 'GAP' });
        x++;
      }
    }
    return { label, seats };
  });
}

async function seedUsers() {
  const admin = await upsertUser(config.SEED_ADMIN_EMAIL, config.SEED_ADMIN_PASSWORD, 'ADMIN', 'Platform Admin');
  const manager = await upsertUser(config.SEED_MANAGER_EMAIL, config.SEED_MANAGER_PASSWORD, 'MANAGER', 'Demo Manager');
  const customer = await upsertUser(config.SEED_CUSTOMER_EMAIL, config.SEED_CUSTOMER_PASSWORD, 'CUSTOMER', 'Demo Customer');

  await prisma.managerProfile.upsert({
    where: { userId: manager.id },
    update: {},
    create: { userId: manager.id, orgName: 'Demo Cinemas Pvt Ltd', verifiedAt: new Date(), verifiedById: admin.id },
  });

  return { admin, manager, customer };
}

async function seedCatalog(managerId: string) {
  const Venue = mongoose.model('Venue', VenueSchema);
  const SeatLayout = mongoose.model('SeatLayout', SeatLayoutSchema);
  const Event = mongoose.model('Event', EventSchema);
  const Show = mongoose.model('Show', ShowSchema);
  await Promise.all([Venue.init(), SeatLayout.init(), Event.init(), Show.init()]);

  const venue = await Venue.findOneAndUpdate(
    { managerId, name: 'Demo Cinemas Phoenix Mall' },
    {
      $setOnInsert: {
        managerId,
        name: 'Demo Cinemas Phoenix Mall',
        city: 'bengaluru',
        address: { line1: 'Whitefield Main Road', state: 'Karnataka', postalCode: '560066', country: 'IN' },
        geo: { type: 'Point', coordinates: [77.6964, 12.9975] },
        halls: [{ hallId: 'audi-1', name: 'Audi 1' }],
      },
    },
    { upsert: true, returnDocument: 'after', runValidators: true },
  );

  let layout = await SeatLayout.findOne({ venueId: venue._id, hallId: 'audi-1', version: 1 });
  if (!layout) {
    layout = await SeatLayout.create({
      venueId: venue._id,
      hallId: 'audi-1',
      version: 1,
      sections: [
        { code: 'RECLINER', name: 'Recliner', priceTier: 'RECLINER', rows: buildRows(['A'], 8, 4, 0) },
        { code: 'GOLD', name: 'Gold', priceTier: 'GOLD', rows: buildRows(['B', 'C', 'D'], 12, 6, 2) },
        { code: 'SILVER', name: 'Silver', priceTier: 'SILVER', rows: buildRows(['E', 'F', 'G', 'H'], 14, 7, 6) },
      ],
    });
    await Venue.updateOne({ _id: venue._id, 'halls.hallId': 'audi-1' }, { $set: { 'halls.$.layoutId': layout._id } });
  }

  const event = await Event.findOneAndUpdate(
    { slug: 'interstellar-re-release' },
    {
      $setOnInsert: {
        managerId,
        title: 'Interstellar (Re-release)',
        slug: 'interstellar-re-release',
        description: 'A team of explorers travel through a wormhole in space in an attempt to ensure humanity’s survival.',
        category: 'MOVIE',
        language: 'English',
        genres: ['sci-fi', 'drama'],
        durationMins: 169,
        ageRating: 'UA',
        cast: [{ name: 'Matthew McConaughey', role: 'Cooper' }],
        status: 'PUBLISHED',
      },
    },
    { upsert: true, returnDocument: 'after', runValidators: true },
  );

  // Tomorrow 19:00 IST (13:30 UTC)
  const startsAt = new Date();
  startsAt.setUTCDate(startsAt.getUTCDate() + 1);
  startsAt.setUTCHours(13, 30, 0, 0);

  // Reuse an upcoming on-sale show; once it is in the past, a fresh one is created.
  let show = await Show.findOne({
    eventId: event._id,
    venueId: venue._id,
    status: 'ON_SALE',
    startsAt: mongoose.trusted({ $gt: new Date() }),
  });
  if (!show) {
    show = await Show.create({
      eventId: event._id,
      managerId,
      venueId: venue._id,
      hallId: 'audi-1',
      layoutId: layout._id,
      layoutVersion: layout.version,
      city: venue.city,
      startsAt,
      endsAt: new Date(startsAt.getTime() + (event.durationMins + 20) * 60_000),
      salesOpenAt: new Date(),
      pricing: { RECLINER: 65000, GOLD: 35000, SILVER: 22000 },
      currency: 'INR',
      status: 'ON_SALE',
    });
  }

  return { venue, layout, event, show };
}

/** Same operation the show-publish flow will perform in Phase 2. */
async function materializeShowSeats(
  show: { _id: Types.ObjectId; eventId: Types.ObjectId; pricing: Map<string, number>; currency: string },
  layout: Parameters<typeof sellableSeats>[0],
) {
  const rows: Prisma.ShowSeatCreateManyInput[] = sellableSeats(layout).map((seat) => {
    const price = show.pricing.get(seat.priceTier);
    if (price === undefined) {
      throw new Error(`show has no price for tier ${seat.priceTier}`);
    }
    return {
      showId: show._id.toHexString(),
      eventId: show.eventId.toHexString(),
      ...seat,
      price: minorToDecimalString(price),
      currency: show.currency,
    };
  });
  const { count } = await prisma.showSeat.createMany({ data: rows, skipDuplicates: true });
  return { total: rows.length, inserted: count };
}

async function main() {
  applyMongooseSecurityDefaults();
  await mongoose.connect(config.MONGO_URL);
  const users = await seedUsers();
  const { venue, layout, event, show } = await seedCatalog(users.manager.id);
  const seats = await materializeShowSeats(show, layout);

  console.table({
    admin: users.admin.email,
    manager: users.manager.email,
    customer: users.customer.email,
    venue: venue._id.toHexString(),
    event: event._id.toHexString(),
    show: show._id.toHexString(),
    showSeats: `${seats.total} (${seats.inserted} new)`,
  });
}

try {
  await main();
} finally {
  await prisma.$disconnect();
  await mongoose.disconnect();
}
