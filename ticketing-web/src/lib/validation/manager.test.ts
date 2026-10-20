import { describe, expect, it } from 'vitest';
import { eventSchema, pricingToPaise, showCreateSchema, splitList, venueSchema } from './manager';

const validEvent = {
  title: 'Dune',
  description: 'Spice.',
  category: 'MOVIE' as const,
  language: '',
  genres: 'Sci-Fi, drama',
  durationMins: '155',
  posterUrl: '',
  bannerUrl: 'https://images.unsplash.com/x.jpg',
  ageRating: 'UA',
  cast: [],
};

describe('manager validation', () => {
  it('accepts a valid event and rejects http posters and bad durations', () => {
    expect(eventSchema.safeParse(validEvent).success).toBe(true);
    expect(eventSchema.safeParse({ ...validEvent, posterUrl: 'http://x.test/a.jpg' }).success).toBe(false);
    expect(eventSchema.safeParse({ ...validEvent, durationMins: '0' }).success).toBe(false);
    expect(eventSchema.safeParse({ ...validEvent, durationMins: '1.5' }).success).toBe(false);
  });

  it('splits genre lists into lower-case items', () => {
    expect(splitList(' Sci-Fi, ,Drama ')).toEqual(['sci-fi', 'drama']);
  });

  it('normalizes city slugs and validates hall ids', () => {
    const base = { name: 'PVR', city: 'Bengaluru', address: { line1: 'MG Road', line2: '', state: 'KA', postalCode: '560001' }, halls: [] };
    const parsed = venueSchema.parse(base);
    expect(parsed.city).toBe('bengaluru');
    expect(venueSchema.safeParse({ ...base, halls: [{ hallId: 'Audi 1', name: 'Audi 1' }] }).success).toBe(false);
  });

  it('requires end after start and sales opening before start', () => {
    const show = {
      eventId: 'a'.repeat(24),
      venueId: 'b'.repeat(24),
      hallId: 'audi-1',
      startsAt: '2026-12-01T18:00',
      endsAt: '2026-12-01T21:00',
      salesOpenAt: '',
      pricing: { GOLD: '450', SILVER: '250.50' },
    };
    expect(showCreateSchema.safeParse(show).success).toBe(true);
    expect(showCreateSchema.safeParse({ ...show, endsAt: '2026-12-01T17:00' }).success).toBe(false);
    expect(showCreateSchema.safeParse({ ...show, salesOpenAt: '2026-12-01T19:00' }).success).toBe(false);
    expect(showCreateSchema.safeParse({ ...show, pricing: { GOLD: '0' } }).success).toBe(false);
  });

  it('converts rupee pricing to paise', () => {
    expect(pricingToPaise({ GOLD: '450', SILVER: '250.50' })).toEqual({ GOLD: 45_000, SILVER: 25_050 });
  });
});
