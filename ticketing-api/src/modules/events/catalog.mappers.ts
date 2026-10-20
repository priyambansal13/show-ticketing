import type { Types } from 'mongoose';
import { minorToDecimalString } from '../../common/money.js';
import type { Event } from './schemas/event.schema.js';
import type { SeatLayout } from './schemas/seat-layout.schema.js';
import type { Show } from './schemas/show.schema.js';
import type { Venue } from './schemas/venue.schema.js';

type WithId<T> = T & { _id: Types.ObjectId; createdAt?: Date; updatedAt?: Date };

const iso = (date: Date | undefined) => date?.toISOString();

export const toVenueDto = (v: WithId<Venue>) => ({
  id: v._id.toHexString(),
  name: v.name,
  city: v.city,
  address: v.address,
  location: v.geo ? { lng: v.geo.coordinates[0], lat: v.geo.coordinates[1] } : null,
  halls: v.halls.map((h) => ({ hallId: h.hallId, name: h.name, layoutId: h.layoutId?.toHexString() ?? null })),
  status: v.status,
  createdAt: iso(v.createdAt),
});

export const toLayoutDto = (l: WithId<SeatLayout>) => ({
  id: l._id.toHexString(),
  venueId: l.venueId.toHexString(),
  hallId: l.hallId,
  version: l.version,
  totalSeats: l.totalSeats,
  sections: l.sections,
});

export const toEventDto = (e: WithId<Event>) => ({
  id: e._id.toHexString(),
  title: e.title,
  slug: e.slug,
  description: e.description,
  category: e.category,
  language: e.language ?? null,
  genres: e.genres,
  durationMins: e.durationMins,
  posterUrl: e.posterUrl ?? null,
  bannerUrl: e.bannerUrl ?? null,
  cast: e.cast.map((c) => ({ name: c.name, role: c.role ?? null })),
  ageRating: e.ageRating ?? null,
  status: e.status,
  createdAt: iso(e.createdAt),
});

/** Pricing in responses: exact decimal strings per tier, plus currency. */
export const pricingDto = (pricing: Map<string, number> | Record<string, number>) =>
  Object.fromEntries(
    (pricing instanceof Map ? [...pricing.entries()] : Object.entries(pricing)).map(([tier, minor]) => [tier, minorToDecimalString(minor)]),
  );

export const toShowDto = (s: WithId<Show>) => ({
  id: s._id.toHexString(),
  eventId: s.eventId.toHexString(),
  venueId: s.venueId.toHexString(),
  hallId: s.hallId,
  layoutId: s.layoutId.toHexString(),
  layoutVersion: s.layoutVersion,
  city: s.city,
  startsAt: s.startsAt.toISOString(),
  endsAt: s.endsAt.toISOString(),
  salesOpenAt: s.salesOpenAt.toISOString(),
  pricing: pricingDto(s.pricing),
  currency: s.currency,
  status: s.status,
});
