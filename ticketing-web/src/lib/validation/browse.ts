import { z } from 'zod';
import type { BrowseQuery } from '@/lib/api/types';

const one = (value: unknown) => (Array.isArray(value) ? value[0] : value);
const optional = <T extends z.ZodType>(schema: T) => z.preprocess((value) => one(value) || undefined, schema.optional()).catch(undefined);

/** URL search params → API browse query. Invalid values are dropped instead of erroring. */
const browseParams = z.object({
  q: optional(z.string().trim().min(2).max(100)),
  city: optional(
    z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z-]{2,64}$/),
  ),
  category: optional(z.enum(['MOVIE', 'CONCERT', 'SPORTS', 'PLAY', 'COMEDY'])),
  date: optional(z.iso.date()),
  page: z.preprocess(one, z.coerce.number().int().min(1).max(1000)).catch(1),
});

export const PAGE_SIZE = 20;

export function parseBrowseParams(params: Record<string, string | string[] | undefined>): BrowseQuery & { page: number } {
  const parsed = browseParams.parse(params);
  return Object.fromEntries(Object.entries({ ...parsed, limit: PAGE_SIZE }).filter(([, value]) => value !== undefined)) as BrowseQuery & {
    page: number;
  };
}
