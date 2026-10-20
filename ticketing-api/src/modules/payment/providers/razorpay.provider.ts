import { Logger } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { safeEqualHex } from './fake.provider.js';
import type { CheckoutConfirmation, CreateOrderInput, PaymentProvider, ProviderEvent, RefundInput } from './payment-provider.js';

const API = 'https://api.razorpay.com/v1';
const TIMEOUT_MS = 5000;
const MAX_ATTEMPTS = 3;

interface RazorpayWebhook {
  event: string;
  payload: {
    payment?: { entity: { id: string; order_id: string; amount: number; currency: string; error_description?: string } };
    refund?: { entity: { id: string; payment_id: string; amount: number } };
  };
}

class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/**
 * Razorpay adapter (Orders API + standard checkout + webhooks).
 * Calls time out after 5 s and retry transient failures with jittered backoff.
 */
export class RazorpayProvider implements PaymentProvider {
  readonly name = 'razorpay' as const;
  private readonly logger = new Logger(RazorpayProvider.name);
  private readonly auth: string;

  constructor(
    readonly publicKey: string,
    private readonly keySecret: string,
    private readonly webhookSecret: string,
  ) {
    this.auth = `Basic ${Buffer.from(`${publicKey}:${keySecret}`).toString('base64')}`;
  }

  async createOrder(input: CreateOrderInput): Promise<{ orderId: string }> {
    const order = await this.call<{ id: string }>(
      'POST',
      '/orders',
      {
        amount: input.amountMinor,
        currency: input.currency,
        receipt: input.receipt,
        notes: { idempotencyKey: input.idempotencyKey },
      },
      input.idempotencyKey,
    );
    return { orderId: order.id };
  }

  verifyCheckout({ orderId, paymentId, signature }: CheckoutConfirmation): boolean {
    const expected = createHmac('sha256', this.keySecret).update(`${orderId}|${paymentId}`).digest('hex');
    return safeEqualHex(expected, signature);
  }

  verifyWebhook(rawBody: Buffer, headers: IncomingHttpHeaders): boolean {
    const signature = headers['x-razorpay-signature'];
    if (typeof signature !== 'string') return false;
    return safeEqualHex(createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex'), signature);
  }

  parseWebhook(rawBody: Buffer, headers: IncomingHttpHeaders): ProviderEvent {
    const body = JSON.parse(rawBody.toString('utf8')) as RazorpayWebhook;
    const eventId = String(headers['x-razorpay-event-id'] ?? '');
    const payment = body.payload.payment?.entity;
    const refund = body.payload.refund?.entity;
    switch (body.event) {
      case 'payment.captured':
        if (!payment) break;
        return {
          kind: 'payment.captured',
          eventId,
          orderId: payment.order_id,
          paymentId: payment.id,
          amountMinor: payment.amount,
          currency: payment.currency,
        };
      case 'payment.failed':
        if (!payment) break;
        return {
          kind: 'payment.failed',
          eventId,
          orderId: payment.order_id,
          paymentId: payment.id,
          reason: payment.error_description ?? 'failed',
        };
      case 'refund.processed':
        if (!refund) break;
        return { kind: 'refund.processed', eventId, refundId: refund.id, paymentId: refund.payment_id, amountMinor: refund.amount };
      case 'refund.failed':
        if (!refund) break;
        return { kind: 'refund.failed', eventId, refundId: refund.id, paymentId: refund.payment_id };
    }
    return { kind: 'ignored', eventId, type: body.event };
  }

  async fetchPayment(paymentId: string) {
    const p = await this.call<{ order_id: string; amount: number; currency: string; status: string }>(
      'GET',
      `/payments/${encodeURIComponent(paymentId)}`,
    );
    return { orderId: p.order_id, amountMinor: p.amount, currency: p.currency, captured: p.status === 'captured' };
  }

  async refund(input: RefundInput): Promise<{ refundId: string; status: 'processed' | 'pending' }> {
    const refund = await this.call<{ id: string; status: string }>(
      'POST',
      `/payments/${encodeURIComponent(input.providerPaymentId)}/refund`,
      { amount: input.amountMinor, speed: 'normal', receipt: input.idempotencyKey.slice(0, 40) },
      input.idempotencyKey,
    );
    return { refundId: refund.id, status: refund.status === 'processed' ? 'processed' : 'pending' };
  }

  async fetchRefund(refundId: string): Promise<{ status: 'processed' | 'pending' | 'failed' }> {
    const refund = await this.call<{ status: string }>('GET', `/refunds/${encodeURIComponent(refundId)}`);
    return { status: refund.status === 'processed' ? 'processed' : refund.status === 'failed' ? 'failed' : 'pending' };
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetch(`${API}${path}`, {
          method,
          headers: {
            Authorization: this.auth,
            'Content-Type': 'application/json',
            ...(idempotencyKey ? { 'X-Razorpay-Idempotency-Key': idempotencyKey } : {}),
          },
          ...(method === 'POST' && body !== undefined ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (res.ok) return (await res.json()) as T;
        const retryable = res.status === 429 || res.status >= 500;
        throw new ProviderError(`Razorpay ${method} ${path} → ${res.status}`, retryable);
      } catch (error) {
        const retryable = error instanceof ProviderError ? error.retryable : true; // network / timeout
        if (!retryable || attempt >= MAX_ATTEMPTS) throw error;
        const delay = 2 ** attempt * 200 + Math.floor(Math.random() * 200);
        this.logger.warn({ path, attempt, delay }, 'Razorpay call failed, retrying');
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
}
