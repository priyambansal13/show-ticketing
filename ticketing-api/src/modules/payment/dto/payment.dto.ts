import { z } from 'zod';

export const InitiatePaymentSchema = z.object({ bookingId: z.uuid() }).strict();
export type InitiatePayment = z.infer<typeof InitiatePaymentSchema>;

export const VerifyPaymentSchema = z
  .object({
    orderId: z.string().min(1).max(64),
    paymentId: z.string().min(1).max(64),
    signature: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
export type VerifyPayment = z.infer<typeof VerifyPaymentSchema>;

export const FakeCompleteSchema = z.object({ orderId: z.string().min(1).max(64) }).strict();
export type FakeComplete = z.infer<typeof FakeCompleteSchema>;
