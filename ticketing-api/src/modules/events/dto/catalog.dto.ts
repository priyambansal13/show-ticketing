import { z } from 'zod';
import { CitySchema, ObjectIdSchema, PaginationSchema } from '../../../common/validation/zod.js';
import { EVENT_CATEGORIES } from '../schemas/event.schema.js';
import { SEAT_TYPES } from '../schemas/seat-layout.schema.js';
import { SHOW_STATUSES } from '../schemas/show.schema.js';

const httpsUrl = z.url({ protocol: /^https$/ }).max(2048);
const code = z.string().regex(/^[A-Z0-9_]{1,32}$/, 'UPPER_SNAKE code, max 32 chars');

// ── Venues ────────────────────────────────────────────────────────────────

const AddressSchema = z
  .object({
    line1: z.string().trim().min(1).max(200),
    line2: z.string().trim().max(200).optional(),
    state: z.string().trim().min(1).max(100),
    postalCode: z.string().trim().min(3).max(12),
    country: z.string().trim().length(2).toUpperCase().default('IN'),
  })
  .strict();

const GeoSchema = z
  .object({ lng: z.number().min(-180).max(180), lat: z.number().min(-90).max(90) })
  .strict()
  .transform(({ lng, lat }) => ({ type: 'Point' as const, coordinates: [lng, lat] as [number, number] }));

const HallInputSchema = z
  .object({
    hallId: z.string().regex(/^[a-z0-9-]{1,32}$/, 'lower-case slug, e.g. "audi-1"'),
    name: z.string().trim().min(1).max(100),
  })
  .strict();

export const CreateVenueSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    city: CitySchema,
    address: AddressSchema,
    geo: GeoSchema.optional(),
    halls: z.array(HallInputSchema).max(50).default([]),
  })
  .strict();
export type CreateVenue = z.infer<typeof CreateVenueSchema>;

export const UpdateVenueSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    address: AddressSchema,
    geo: GeoSchema,
    status: z.enum(['ACTIVE', 'INACTIVE']),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'at least one field is required');
export type UpdateVenue = z.infer<typeof UpdateVenueSchema>;

export const AddHallSchema = HallInputSchema;
export type AddHall = z.infer<typeof AddHallSchema>;

// ── Seat layouts ──────────────────────────────────────────────────────────

export const PutLayoutSchema = z
  .object({
    sections: z
      .array(
        z
          .object({
            code,
            name: z.string().trim().min(1).max(64),
            priceTier: code,
            rows: z
              .array(
                z
                  .object({
                    label: z.string().regex(/^[A-Z]{1,3}$/),
                    seats: z
                      .array(
                        z
                          .object({
                            id: z.string().regex(/^[A-Z0-9-]{1,16}$/),
                            number: z.number().int().min(1),
                            x: z.number().int().min(0).max(1000),
                            y: z.number().int().min(0).max(1000),
                            type: z.enum(SEAT_TYPES).default('REGULAR'),
                          })
                          .strict(),
                      )
                      .min(1)
                      .max(200),
                  })
                  .strict(),
              )
              .min(1)
              .max(100),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();
export type PutLayout = z.infer<typeof PutLayoutSchema>;

// ── Events ────────────────────────────────────────────────────────────────

const genres = z.array(z.string().trim().toLowerCase().min(1).max(40)).max(10);
const cast = z.array(z.object({ name: z.string().trim().min(1).max(120), role: z.string().trim().max(120).optional() }).strict()).max(50);

const EventFields = {
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5000),
  category: z.enum(EVENT_CATEGORIES),
  language: z.string().trim().max(40).optional(),
  genres,
  durationMins: z
    .number()
    .int()
    .min(1)
    .max(24 * 60),
  posterUrl: httpsUrl.optional(),
  bannerUrl: httpsUrl.optional(),
  cast,
  ageRating: z.string().trim().max(8).optional(),
};

export const CreateEventSchema = z.object({ ...EventFields, genres: genres.default([]), cast: cast.default([]) }).strict();
export type CreateEvent = z.infer<typeof CreateEventSchema>;

// No defaults here: `.partial()` keeps defaults, which would overwrite stored values on PATCH.
export const UpdateEventSchema = z
  .object(EventFields)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'at least one field is required');
export type UpdateEvent = z.infer<typeof UpdateEventSchema>;

// ── Shows ─────────────────────────────────────────────────────────────────

const PricingSchema = z
  .record(code, z.number().int().positive().max(10_000_000))
  .refine((pricing) => Object.keys(pricing).length > 0 && Object.keys(pricing).length <= 20, '1–20 price tiers');

const ShowTimes = z.object({
  startsAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
  endsAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
  salesOpenAt: z.iso
    .datetime({ offset: true })
    .transform((value) => new Date(value))
    .optional(),
});

export const CreateShowSchema = ShowTimes.extend({
  eventId: ObjectIdSchema,
  venueId: ObjectIdSchema,
  hallId: z.string().regex(/^[a-z0-9-]{1,32}$/),
  /** priceTier → price in minor units (paise) */
  pricing: PricingSchema,
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default('INR'),
}).strict();
export type CreateShow = z.infer<typeof CreateShowSchema>;

export const UpdateShowSchema = ShowTimes.partial()
  .extend({ pricing: PricingSchema.optional() })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'at least one field is required');
export type UpdateShow = z.infer<typeof UpdateShowSchema>;

export const ManagerShowsQuerySchema = PaginationSchema.extend({
  eventId: ObjectIdSchema.optional(),
  status: z.enum(SHOW_STATUSES).optional(),
});
export type ManagerShowsQuery = z.infer<typeof ManagerShowsQuerySchema>;

export const SeatIdsSchema = z
  .object({
    seatIds: z
      .array(z.string().regex(/^[A-Z0-9-]{1,16}$/))
      .min(1)
      .max(500),
  })
  .strict()
  .transform(({ seatIds }) => ({ seatIds: [...new Set(seatIds)] }));
export type SeatIds = z.infer<typeof SeatIdsSchema>;

// ── Public browsing ───────────────────────────────────────────────────────

export const BrowseEventsQuerySchema = PaginationSchema.extend({
  city: CitySchema.optional(),
  category: z.enum(EVENT_CATEGORIES).optional(),
  /** Day (YYYY-MM-DD, IST) on which the event has a show */
  date: z.iso.date().optional(),
  q: z.string().trim().min(2).max(100).optional(),
});
export type BrowseEventsQuery = z.infer<typeof BrowseEventsQuerySchema>;

export const EventShowsQuerySchema = z.object({
  city: CitySchema.optional(),
  date: z.iso.date().optional(),
});
export type EventShowsQuery = z.infer<typeof EventShowsQuerySchema>;
