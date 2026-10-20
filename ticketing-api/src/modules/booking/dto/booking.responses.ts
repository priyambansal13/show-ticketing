/**
 * Response contracts of the booking and payment APIs (OpenAPI → ticketing-web types).
 * Must match BookingService.toDto / PaymentService — enforced by test/e2e/contract.e2e-spec.ts.
 */
import { z } from 'zod';
import { IsoDateTimeSchema, MoneySchema, pageSchema } from '../../../common/validation/zod.js';
import { ShowResponse } from '../../events/dto/catalog.responses.js';

const BookingStatus = z.enum(['PENDING', 'CONFIRMED', 'EXPIRED', 'CANCELLED', 'FAILED']);
const PaymentStatus = z.enum(['CREATED', 'AUTHORIZED', 'CAPTURED', 'CAPTURED_DUPLICATE', 'FAILED', 'REFUNDED']);

export const ShowSummaryResponse = z.object({
  showId: z.string(),
  eventId: z.string(),
  eventTitle: z.string(),
  posterUrl: z.string().nullable(),
  venueName: z.string(),
  city: z.string(),
  hallName: z.string(),
  startsAt: IsoDateTimeSchema,
  showStatus: z.string(),
});

export const BookingResponse = z.object({
  id: z.uuid(),
  bookingRef: z.string(),
  status: BookingStatus,
  showId: z.string(),
  eventId: z.string(),
  show: ShowSummaryResponse.nullable(),
  seats: z.array(z.object({ seatId: z.string(), section: z.string(), row: z.string(), number: z.number().int(), price: MoneySchema })),
  totalAmount: MoneySchema,
  currency: z.string().length(3),
  /** Only while PENDING: pay before this moment */
  holdExpiresAt: IsoDateTimeSchema.nullable(),
  paymentStatus: PaymentStatus.nullable(),
  createdAt: IsoDateTimeSchema,
  confirmedAt: IsoDateTimeSchema.nullable(),
  cancelledAt: IsoDateTimeSchema.nullable(),
});
export const BookingPage = pageSchema(BookingResponse);

export const TicketResponse = BookingResponse.extend({ ticketCode: z.string(), qrCodeDataUrl: z.string() });

export const ShowBookingPage = pageSchema(BookingResponse.extend({ customer: z.object({ name: z.string(), email: z.string() }) }));

export const TicketVerificationResponse = z.object({
  valid: z.boolean(),
  reason: z.enum(['NOT_CONFIRMED', 'ALREADY_CHECKED_IN', 'SHOW_CANCELLED']).nullable(),
  checkedInAt: IsoDateTimeSchema.nullable(),
  booking: BookingResponse,
});

export const CancelShowResponse = z.object({ show: ShowResponse, status: z.literal('CANCELLING') });

const Totals = z.object({
  shows: z.number().int(),
  seatsSold: z.number().int(),
  confirmedBookings: z.number().int(),
  grossRevenue: MoneySchema,
  refunded: MoneySchema,
  netRevenue: z.string(),
});
export const SalesReportResponse = z.object({
  totals: Totals,
  shows: z.array(
    z.object({
      show: ShowSummaryResponse,
      seats: z.object({ total: z.number().int(), sold: z.number().int(), held: z.number().int(), blocked: z.number().int() }),
      occupancyPercent: z.number(),
      bookings: z.object({ confirmed: z.number().int(), cancelled: z.number().int() }),
      grossRevenue: MoneySchema,
      refunded: MoneySchema,
      netRevenue: z.string(),
    }),
  ),
});

// ── Payments ──
export const InitiatePaymentResponse = z.object({
  paymentId: z.uuid(),
  provider: z.enum(['fake', 'razorpay']),
  /** Public checkout key (never the secret) */
  publicKey: z.string().nullable(),
  orderId: z.string().nullable(),
  amount: MoneySchema,
  amountMinor: z.number().int(),
  currency: z.string().length(3),
  bookingRef: z.string(),
  holdExpiresAt: IsoDateTimeSchema,
});

export const VerifyPaymentResponse = z.object({
  outcome: z.enum([
    'confirmed',
    'already_settled',
    'duplicate_refunded',
    'refunded_seats_unavailable',
    'refunded_not_payable',
    'amount_mismatch',
    'pending_capture',
  ]),
  booking: BookingResponse,
});

export const CheckoutConfirmationResponse = z.object({ orderId: z.string(), paymentId: z.string(), signature: z.string() });
