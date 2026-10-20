/**
 * Response contracts of the catalog API (OpenAPI → ticketing-web generated types).
 * Must match catalog.mappers.ts — enforced by test/e2e/contract.e2e-spec.ts.
 */
import { z } from 'zod';
import { IsoDateTimeSchema, MoneySchema, pageSchema } from '../../../common/validation/zod.js';
import { EVENT_CATEGORIES, EVENT_STATUSES } from '../schemas/event.schema.js';
import { SEAT_TYPES } from '../schemas/seat-layout.schema.js';
import { SHOW_STATUSES } from '../schemas/show.schema.js';

const Id = z.string().regex(/^[0-9a-f]{24}$/);
const Pricing = z.record(z.string(), MoneySchema);

export const VenueResponse = z.object({
  id: Id,
  name: z.string(),
  city: z.string(),
  address: z.object({ line1: z.string(), line2: z.string().optional(), state: z.string(), postalCode: z.string(), country: z.string() }),
  location: z.object({ lng: z.number(), lat: z.number() }).nullable(),
  halls: z.array(z.object({ hallId: z.string(), name: z.string(), layoutId: Id.nullable() })),
  status: z.enum(['ACTIVE', 'INACTIVE']),
  createdAt: IsoDateTimeSchema.optional(),
});

const LayoutSeat = z.object({ id: z.string(), number: z.number().int(), x: z.number(), y: z.number(), type: z.enum(SEAT_TYPES) });
export const LayoutResponse = z.object({
  id: Id,
  venueId: Id,
  hallId: z.string(),
  version: z.number().int(),
  totalSeats: z.number().int(),
  sections: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      priceTier: z.string(),
      rows: z.array(z.object({ label: z.string(), seats: z.array(LayoutSeat) })),
    }),
  ),
});

export const EventResponse = z.object({
  id: Id,
  title: z.string(),
  slug: z.string(),
  description: z.string(),
  category: z.enum(EVENT_CATEGORIES),
  language: z.string().nullable(),
  genres: z.array(z.string()),
  durationMins: z.number().int(),
  posterUrl: z.string().nullable(),
  bannerUrl: z.string().nullable(),
  cast: z.array(z.object({ name: z.string(), role: z.string().nullable() })),
  ageRating: z.string().nullable(),
  status: z.enum(EVENT_STATUSES),
  createdAt: IsoDateTimeSchema.optional(),
});

export const ShowResponse = z.object({
  id: Id,
  eventId: Id,
  venueId: Id,
  hallId: z.string(),
  layoutId: Id,
  layoutVersion: z.number().int(),
  city: z.string(),
  startsAt: IsoDateTimeSchema,
  endsAt: IsoDateTimeSchema,
  salesOpenAt: IsoDateTimeSchema,
  /** tier → exact decimal price */
  pricing: Pricing,
  currency: z.string().length(3),
  status: z.enum(SHOW_STATUSES),
});

export const PublishedShowResponse = ShowResponse.extend({ totalSeats: z.number().int() });

export const EventShowResponse = ShowResponse.extend({
  venue: z.object({ id: Id, name: z.string(), city: z.string(), hallName: z.string() }).nullable(),
});

export const ShowDetailResponse = ShowResponse.extend({
  event: z.object({
    id: Id,
    title: z.string(),
    slug: z.string(),
    durationMins: z.number().int(),
    posterUrl: z.string().nullable(),
    ageRating: z.string().nullable(),
  }),
  venue: z.object({ id: Id, name: z.string(), city: z.string(), address: VenueResponse.shape.address, hallName: z.string() }),
});

export const SeatMapResponse = z.object({
  showId: Id,
  currency: z.string().length(3),
  salesOpen: z.boolean(),
  totalSeats: z.number().int(),
  availableSeats: z.number().int(),
  sections: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      priceTier: z.string(),
      price: MoneySchema.nullable(),
      rows: z.array(
        z.object({
          label: z.string(),
          /** `status` is null for GAP cells (aisles), otherwise AVAILABLE / UNAVAILABLE */
          seats: z.array(LayoutSeat.extend({ status: z.enum(['AVAILABLE', 'UNAVAILABLE']).nullable() })),
        }),
      ),
    }),
  ),
});

export const BlockSeatsResponse = z.object({ changed: z.array(z.string()), skipped: z.array(z.string()) });
export const CitiesResponse = z.array(z.string());

export const VenuePage = pageSchema(VenueResponse);
export const EventPage = pageSchema(EventResponse);
export const ShowPage = pageSchema(ShowResponse);
