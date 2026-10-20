import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import type { CheckoutConfirmation, CreateOrderInput, PaymentProvider, ProviderEvent, RefundInput } from './payment-provider.js';

const hmac = (secret: string, data: string | Buffer) => createHmac('sha256', secret).update(data).digest('hex');

export const safeEqualHex = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Local provider for development and tests — never allowed in production
 * (enforced by env validation). Mirrors Razorpay's signature scheme:
 *   checkout signature = HMAC(secret, `${orderId}|${paymentId}`)
 *   webhook  signature = HMAC(secret, rawBody) in `x-fake-signature`
 */
export class FakePaymentProvider implements PaymentProvider {
  readonly name = 'fake' as const;
  readonly publicKey = 'fake_public_key';
  // In-memory state is fine for a dev/test-only provider.
  private readonly orders = new Map<string, { amountMinor: number; currency: string }>();
  private readonly payments = new Map<string, string>(); // paymentId → orderId

  constructor(private readonly secret: string) {}

  createOrder(input: CreateOrderInput): Promise<{ orderId: string }> {
    const orderId = `order_fake_${createHmac('sha256', this.secret).update(input.idempotencyKey).digest('hex').slice(0, 14)}_${randomBytes(3).toString('hex')}`;
    this.orders.set(orderId, { amountMinor: input.amountMinor, currency: input.currency });
    return Promise.resolve({ orderId });
  }

  /** Test/dev helper: what the browser checkout would return after a successful payment. */
  completeCheckout(orderId: string): CheckoutConfirmation {
    const paymentId = `pay_fake_${randomBytes(7).toString('hex')}`;
    this.payments.set(paymentId, orderId);
    return { orderId, paymentId, signature: hmac(this.secret, `${orderId}|${paymentId}`) };
  }

  /** Test helper: sign a webhook body. */
  signWebhook(rawBody: string): string {
    return hmac(this.secret, rawBody);
  }

  verifyCheckout({ orderId, paymentId, signature }: CheckoutConfirmation): boolean {
    return safeEqualHex(hmac(this.secret, `${orderId}|${paymentId}`), signature);
  }

  verifyWebhook(rawBody: Buffer, headers: IncomingHttpHeaders): boolean {
    const signature = headers['x-fake-signature'];
    return typeof signature === 'string' && safeEqualHex(hmac(this.secret, rawBody), signature);
  }

  parseWebhook(rawBody: Buffer): ProviderEvent {
    return JSON.parse(rawBody.toString('utf8')) as ProviderEvent;
  }

  fetchPayment(paymentId: string) {
    const orderId = this.payments.get(paymentId);
    const order = orderId ? this.orders.get(orderId) : undefined;
    return Promise.resolve({
      orderId: orderId ?? '',
      amountMinor: order?.amountMinor ?? 0,
      currency: order?.currency ?? 'INR',
      captured: Boolean(order),
    });
  }

  fetchRefund(): Promise<{ status: 'processed' }> {
    return Promise.resolve({ status: 'processed' });
  }

  refund(input: RefundInput): Promise<{ refundId: string; status: 'processed' }> {
    return Promise.resolve({ refundId: `rfnd_fake_${hmac(this.secret, input.idempotencyKey).slice(0, 14)}`, status: 'processed' });
  }
}
