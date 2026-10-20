import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.js';
import { createPaymentProvider } from '../payment.module.js';
import { FakePaymentProvider, safeEqualHex } from './fake.provider.js';
import { RazorpayProvider } from './razorpay.provider.js';

const configOf = (values: Partial<Env>) => ({ get: (key: keyof Env) => values[key] }) as unknown as ConfigService<Env, true>;

describe('createPaymentProvider', () => {
  it('selects Razorpay when configured', () => {
    const provider = createPaymentProvider(
      configOf({ PAYMENT_PROVIDER: 'razorpay', RAZORPAY_KEY_ID: 'k', RAZORPAY_KEY_SECRET: 's', RAZORPAY_WEBHOOK_SECRET: 'w' }),
    );
    expect(provider).toBeInstanceOf(RazorpayProvider);
    expect(provider.publicKey).toBe('k');
  });

  it('defaults to the fake provider', () => {
    expect(createPaymentProvider(configOf({ PAYMENT_PROVIDER: 'fake', FAKE_PAYMENT_SECRET: 'f'.repeat(16) }))).toBeInstanceOf(
      FakePaymentProvider,
    );
  });
});

describe('FakePaymentProvider', () => {
  const provider = new FakePaymentProvider('fake-secret-for-tests');

  it('completes checkouts with verifiable signatures and reports the order amount', async () => {
    const { orderId } = await provider.createOrder({ amountMinor: 1234, currency: 'INR', receipt: 'r', idempotencyKey: 'k' });
    const confirmation = provider.completeCheckout(orderId);
    expect(provider.verifyCheckout(confirmation)).toBe(true);
    expect(provider.verifyCheckout({ ...confirmation, paymentId: 'pay_other' })).toBe(false);
    await expect(provider.fetchPayment(confirmation.paymentId)).resolves.toEqual({
      orderId,
      amountMinor: 1234,
      currency: 'INR',
      captured: true,
    });
    await expect(provider.fetchPayment('pay_unknown')).resolves.toMatchObject({ captured: false, orderId: '' });
  });

  it('verifies webhook signatures and refunds deterministically', async () => {
    const body = '{"kind":"ignored","eventId":"e","type":"x"}';
    expect(provider.verifyWebhook(Buffer.from(body), { 'x-fake-signature': provider.signWebhook(body) })).toBe(true);
    expect(provider.verifyWebhook(Buffer.from(body), {})).toBe(false);
    expect(provider.parseWebhook(Buffer.from(body))).toEqual({ kind: 'ignored', eventId: 'e', type: 'x' });
    const a = await provider.refund({ providerPaymentId: 'p', amountMinor: 1, idempotencyKey: 'same' });
    const b = await provider.refund({ providerPaymentId: 'p', amountMinor: 1, idempotencyKey: 'same' });
    expect(a).toEqual(b);
    await expect(provider.fetchRefund()).resolves.toEqual({ status: 'processed' });
  });

  it('compares hex signatures in constant time and handles length mismatch', () => {
    expect(safeEqualHex('abcd', 'abcd')).toBe(true);
    expect(safeEqualHex('abcd', 'abce')).toBe(false);
    expect(safeEqualHex('abcd', 'abc')).toBe(false);
  });
});
