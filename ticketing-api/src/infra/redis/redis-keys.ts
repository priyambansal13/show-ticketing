/**
 * Every Redis key pattern used by the API. Keep in sync with
 * docs/IMPLEMENTATION_PLAN.md §4.3 — add new patterns here, never inline strings.
 */
export const redisKeys = {
  /** string → bookingId, PX = hold TTL. Set atomically for all seats of a hold. */
  seatHold: (showId: string, seatId: string) => `hold:${showId}:${seatId}`,
  /** hash seatId → 'A' | 'H' | 'B' | 'X' (available / held / booked / blocked) */
  seatAvailability: (showId: string) => `avail:${showId}`,
  eventCache: (eventId: string) => `cache:event:${eventId}`,
  eventShowsCache: (eventId: string) => `cache:event-shows:${eventId}`,
  showCache: (showId: string) => `cache:show:${showId}`,
  /** Search/browse results keyed by a hash of the normalized query; short TTL, no explicit invalidation. */
  eventSearchCache: (queryHash: string) => `cache:events:${queryHash}`,
  layoutCache: (layoutId: string) => `cache:layout:${layoutId}`,
  rateLimit: (scope: string, subject: string) => `rl:${scope}:${subject}`,
} as const;
