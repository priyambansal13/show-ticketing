import { z } from 'zod';
import { rupeesToPaise } from '@/lib/format';

/**
 * Form schemas for the manager portal. They mirror ticketing-api
 * src/modules/events/dto/catalog.dto.ts — the API remains the authority and its
 * VALIDATION_FAILED details are mapped back onto these fields.
 * Inputs are the raw strings a form holds; conversion to API bodies happens in the pages.
 */

export const CODE_PATTERN = /^[A-Z0-9_]{1,32}$/;
export const HALL_ID_PATTERN = /^[a-z0-9-]{1,32}$/;
export const CITY_PATTERN = /^[a-z-]{2,64}$/;
export const EVENT_CATEGORIES = ['MOVIE', 'CONCERT', 'SPORTS', 'PLAY', 'COMEDY'] as const;

const optionalText = (max: number) => z.string().trim().max(max, `Use at most ${max} characters`);
const httpsUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => value === '' || /^https:\/\/[^\s]+$/.test(value), 'Use an https:// URL');

// ── Venues ────────────────────────────────────────────────────────────────
export const addressSchema = z.object({
  line1: z.string().trim().min(1, 'Enter the street address').max(200),
  line2: optionalText(200),
  state: z.string().trim().min(1, 'Enter the state').max(100),
  postalCode: z.string().trim().min(3, 'Enter a postal code').max(12),
});

export const hallSchema = z.object({
  hallId: z.string().trim().regex(HALL_ID_PATTERN, 'Lower-case letters, digits and dashes, e.g. "audi-1"'),
  name: z.string().trim().min(1, 'Enter the hall name').max(100),
});
export type HallValues = z.infer<typeof hallSchema>;

export const venueSchema = z.object({
  name: z.string().trim().min(1, 'Enter the venue name').max(200),
  city: z.string().trim().toLowerCase().regex(CITY_PATTERN, 'City slug, e.g. "bengaluru" or "new-delhi"'),
  address: addressSchema,
  halls: z.array(hallSchema).max(50),
});
export type VenueValues = z.input<typeof venueSchema>;

export const venueEditSchema = z.object({
  name: z.string().trim().min(1, 'Enter the venue name').max(200),
  address: addressSchema,
  status: z.enum(['ACTIVE', 'INACTIVE']),
});
export type VenueEditValues = z.input<typeof venueEditSchema>;

// ── Events ────────────────────────────────────────────────────────────────
export const eventSchema = z.object({
  title: z.string().trim().min(1, 'Enter a title').max(200),
  description: z.string().trim().min(1, 'Enter a description').max(5000),
  category: z.enum(EVENT_CATEGORIES),
  language: optionalText(40),
  genres: z
    .string()
    .trim()
    .refine((value) => splitList(value).length <= 10, 'At most 10 genres')
    .refine((value) => splitList(value).every((genre) => genre.length <= 40), 'Each genre at most 40 characters'),
  durationMins: z
    .string()
    .trim()
    .regex(/^\d+$/, 'Whole minutes')
    .refine((value) => Number(value) >= 1 && Number(value) <= 1440, 'Between 1 and 1440 minutes'),
  posterUrl: httpsUrl,
  bannerUrl: httpsUrl,
  ageRating: optionalText(8),
  cast: z.array(z.object({ name: z.string().trim().min(1, 'Enter a name').max(120), role: optionalText(120) })).max(50),
});
export type EventValues = z.input<typeof eventSchema>;

export const splitList = (value: string): string[] =>
  value
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

// ── Shows ─────────────────────────────────────────────────────────────────
const DATETIME_LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const rupees = z.string().refine((value) => {
  const paise = rupeesToPaise(value);
  return paise !== null && paise > 0 && paise <= 10_000_000;
}, 'Price in rupees, up to 2 decimals (max ₹1,00,000)');

export const showTimesSchema = z
  .object({
    startsAt: z.string().regex(DATETIME_LOCAL, 'Pick the start date and time'),
    endsAt: z.string().regex(DATETIME_LOCAL, 'Pick the end date and time'),
    salesOpenAt: z.string().refine((value) => value === '' || DATETIME_LOCAL.test(value), 'Pick a valid date and time'),
    pricing: z.record(z.string(), rupees),
  })
  .refine((value) => value.endsAt > value.startsAt, { path: ['endsAt'], message: 'Must be after the start time' })
  .refine((value) => value.salesOpenAt === '' || value.salesOpenAt < value.startsAt, {
    path: ['salesOpenAt'],
    message: 'Sales must open before the show starts',
  });
export type ShowTimesValues = z.infer<typeof showTimesSchema>;

export const showCreateSchema = z
  .object({
    eventId: z.string().regex(/^[0-9a-f]{24}$/, 'Pick an event'),
    venueId: z.string().regex(/^[0-9a-f]{24}$/, 'Pick a venue'),
    hallId: z.string().regex(HALL_ID_PATTERN, 'Pick a hall'),
  })
  .and(showTimesSchema);
export type ShowCreateValues = z.infer<typeof showCreateSchema>;

/** Converts a rupee pricing form record to the API's integer paise record. */
export function pricingToPaise(pricing: Record<string, string>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [tier, value] of Object.entries(pricing)) {
    const paise = rupeesToPaise(value);
    if (paise !== null) result[tier] = paise;
  }
  return result;
}
