import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { api } from './client';
import type { BrowseQuery, CatalogEvent, EventPage, EventShow, ShowDetail } from './types';

/**
 * Public catalog reads for Server Components, cached with `use cache` (the Cache Components
 * replacement for ISR). The API caches in Redis too; this layer saves the network hop and lets
 * catalog pages prerender. Failures are cached for seconds only, so an API blip heals quickly.
 */

export type Result<T> = { ok: true; data: T } | { ok: false; status: number };

async function read<T>(call: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<Result<T>> {
  try {
    const { data, response } = await call;
    return response.ok && data !== undefined ? { ok: true, data } : { ok: false, status: response.status };
  } catch {
    return { ok: false, status: 503 };
  }
}

export async function getCities(): Promise<string[]> {
  'use cache';
  cacheTag('catalog', 'cities');
  const result = await read(api().GET('/api/v1/cities'));
  if (!result.ok) {
    cacheLife('seconds');
    return [];
  }
  cacheLife('hours');
  return result.data;
}

export async function browseEvents(query: BrowseQuery): Promise<Result<EventPage>> {
  'use cache';
  cacheTag('catalog', 'events');
  const result = await read(api().GET('/api/v1/events', { params: { query } }));
  if (result.ok) cacheLife('minutes');
  else cacheLife('seconds');
  return result;
}

export async function getEvent(idOrSlug: string): Promise<Result<CatalogEvent>> {
  'use cache';
  cacheTag('catalog', `event:${idOrSlug}`);
  const result = await read(api().GET('/api/v1/events/{idOrSlug}', { params: { path: { idOrSlug } } }));
  if (result.ok) cacheLife('minutes');
  else cacheLife('seconds');
  return result;
}

export async function getEventShows(eventId: string, city?: string): Promise<Result<EventShow[]>> {
  'use cache';
  cacheTag('catalog', `event-shows:${eventId}`);
  const result = await read(api().GET('/api/v1/events/{id}/shows', { params: { path: { id: eventId }, query: city ? { city } : {} } }));
  if (result.ok) cacheLife('minutes');
  else cacheLife('seconds');
  return result;
}

export async function getShow(showId: string): Promise<Result<ShowDetail>> {
  'use cache';
  cacheTag('catalog', `show:${showId}`);
  const result = await read(api().GET('/api/v1/shows/{id}', { params: { path: { id: showId } } }));
  if (result.ok) cacheLife('minutes');
  else cacheLife('seconds');
  return result;
}
