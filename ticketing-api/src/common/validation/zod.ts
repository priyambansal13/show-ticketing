import { applyDecorators, type PipeTransform } from '@nestjs/common';
import { ApiBody, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { z, type ZodType } from 'zod';

/**
 * Validates and transforms a request part with a zod schema:
 *   @Body(zodPipe(CreateVenueSchema)) body: CreateVenue
 * Failures throw ZodError → 400 VALIDATION_FAILED (AllExceptionsFilter).
 */
export function zodPipe<T extends ZodType>(schema: T): PipeTransform<unknown, z.output<T>> {
  return { transform: (value: unknown) => schema.parse(value) };
}

/** JSON Schema (draft 2020-12) for OpenAPI 3.1, generated from the same zod schema. */
function toOpenApi(schema: ZodType, io: 'input' | 'output'): Record<string, unknown> {
  const { $schema: _ignored, ...json } = z.toJSONSchema(schema, { io, unrepresentable: 'any' }) as Record<string, unknown>;
  return json;
}

export const ApiZodBody = (schema: ZodType) => ApiBody({ schema: toOpenApi(schema, 'input') as never });

export const ApiZodResponse = (status: number, schema: ZodType, description?: string) =>
  ApiResponse({ status, description, schema: toOpenApi(schema, 'output') as never });

/** Documents each top-level property of an object schema as a query parameter. */
export function ApiZodQuery(schema: z.ZodObject) {
  return applyDecorators(
    ...Object.entries(schema.shape).map(([name, field]) =>
      ApiQuery({ name, required: !(field as ZodType).safeParse(undefined).success, schema: toOpenApi(field as ZodType, 'input') as never }),
    ),
  );
}

// ── Shared primitives ──────────────────────────────────────────────────────

export const ObjectIdSchema = z.string().regex(/^[0-9a-f]{24}$/, 'must be a 24-character hex id');
export const UuidSchema = z.uuid();
export const CitySchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z-]{2,64}$/, 'must be a city slug, e.g. "bengaluru"');

export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type Pagination = z.infer<typeof PaginationSchema>;

export interface Page<T> {
  data: T[];
  meta: { page: number; limit: number; total: number };
}

export const pageOf = <T>(data: T[], total: number, { page, limit }: Pagination): Page<T> => ({
  data,
  meta: { page, limit, total },
});

/** Exact decimal string "450.50" for money in responses — never a float. */
export const MoneySchema = z.string().regex(/^\d+\.\d{2}$/);

/** `{ data, meta }` page envelope for list responses. */
export const pageSchema = <T extends ZodType>(item: T) =>
  z.object({ data: z.array(item), meta: z.object({ page: z.number().int(), limit: z.number().int(), total: z.number().int() }) });

export const IsoDateTimeSchema = z.iso.datetime({ offset: true });
