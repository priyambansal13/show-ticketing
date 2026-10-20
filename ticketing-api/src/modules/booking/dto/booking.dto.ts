import { z } from 'zod';
import { ObjectIdSchema, PaginationSchema } from '../../../common/validation/zod.js';

export const HoldSeatsSchema = z
  .object({
    showId: ObjectIdSchema,
    seatIds: z
      .array(z.string().regex(/^[A-Z0-9-]{1,16}$/))
      .min(1)
      .max(50)
      .refine((ids) => new Set(ids).size === ids.length, 'seatIds must be unique'),
  })
  .strict();
export type HoldSeats = z.infer<typeof HoldSeatsSchema>;

export const ListBookingsQuerySchema = PaginationSchema.extend({
  status: z.enum(['PENDING', 'CONFIRMED', 'EXPIRED', 'CANCELLED', 'FAILED']).optional(),
});
export type ListBookingsQuery = z.infer<typeof ListBookingsQuerySchema>;

export const ShowBookingsQuerySchema = PaginationSchema.extend({
  status: z.enum(['PENDING', 'CONFIRMED', 'EXPIRED', 'CANCELLED', 'FAILED']).optional(),
});
export type ShowBookingsQuery = z.infer<typeof ShowBookingsQuerySchema>;

export const VerifyTicketSchema = z.object({ code: z.string().min(10).max(200) }).strict();
export type VerifyTicket = z.infer<typeof VerifyTicketSchema>;

export const SalesReportQuerySchema = z
  .object({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
  })
  .strict();
export type SalesReportQuery = z.infer<typeof SalesReportQuerySchema>;
