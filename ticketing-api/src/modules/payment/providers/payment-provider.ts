import type { IncomingHttpHeaders } from 'node:http';

export interface CreateOrderInput {
  amountMinor: number;
  currency: string;
  /** Shown on the provider dashboard, e.g. the booking reference. */
  receipt: string;
  /** Same key → same order (provider-side dedupe). */
  idempotencyKey: string;
}

export interface CheckoutConfirmation {
  orderId: string;
  paymentId: string;
  signature: string;
}

export type ProviderEvent =
  | { kind: 'payment.captured'; eventId: string; orderId: string; paymentId: string; amountMinor: number; currency: string }
  | { kind: 'payment.failed'; eventId: string; orderId: string; paymentId: string; reason: string }
  | { kind: 'refund.processed'; eventId: string; refundId: string; paymentId: string; amountMinor: number }
  | { kind: 'refund.failed'; eventId: string; refundId: string; paymentId: string }
  | { kind: 'ignored'; eventId: string; type: string };

export interface RefundInput {
  providerPaymentId: string;
  amountMinor: number;
  idempotencyKey: string;
}

/** Abstraction over Razorpay / Stripe / the local fake (docs/IMPLEMENTATION_PLAN.md D1). */
export interface PaymentProvider {
  readonly name: 'fake' | 'razorpay';
  /** Public key the browser checkout needs (never the secret). */
  readonly publicKey: string | null;
  createOrder(input: CreateOrderInput): Promise<{ orderId: string }>;
  /** Signature returned by the browser checkout after payment. */
  verifyCheckout(confirmation: CheckoutConfirmation): boolean;
  /** Signature of a webhook over its exact raw body. */
  verifyWebhook(rawBody: Buffer, headers: IncomingHttpHeaders): boolean;
  parseWebhook(rawBody: Buffer, headers: IncomingHttpHeaders): ProviderEvent;
  /** Amount actually captured for a checkout payment (verified server-side). */
  fetchPayment(paymentId: string): Promise<{ orderId: string; amountMinor: number; currency: string; captured: boolean }>;
  refund(input: RefundInput): Promise<{ refundId: string; status: 'processed' | 'pending' }>;
  /** Current state of a submitted refund (reconciliation of refunds still pending at the provider). */
  fetchRefund(refundId: string): Promise<{ status: 'processed' | 'pending' | 'failed' }>;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
