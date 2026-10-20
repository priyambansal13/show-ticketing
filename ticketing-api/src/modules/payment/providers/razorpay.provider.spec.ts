import { createHmac } from 'node:crypto';
import { RazorpayProvider } from './razorpay.provider.js';

const KEY_ID = 'rzp_test_key';
const KEY_SECRET = 'rzp_test_secret';
const WEBHOOK_SECRET = 'rzp_webhook_secret';
const hmac = (secret: string, data: string) => createHmac('sha256', secret).update(data).digest('hex');
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('RazorpayProvider', () => {
  const provider = new RazorpayProvider(KEY_ID, KEY_SECRET, WEBHOOK_SECRET);
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('creates an order with basic auth, idempotency header and amount in minor units', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { id: 'order_123' }));
    await expect(provider.createOrder({ amountMinor: 45050, currency: 'INR', receipt: 'BMS1', idempotencyKey: 'b:1' })).resolves.toEqual({
      orderId: 'order_123',
    });

    const [url, init = {}] = fetchMock.mock.calls[0]!;
    const headers = init.headers as Record<string, string>;
    expect(url).toBe('https://api.razorpay.com/v1/orders');
    expect(init.method).toBe('POST');
    expect(headers['Authorization']).toBe(`Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64')}`);
    expect(headers['X-Razorpay-Idempotency-Key']).toBe('b:1');
    expect(JSON.parse(String(init.body))).toMatchObject({ amount: 45050, currency: 'INR', receipt: 'BMS1' });
  });

  it('retries transient failures (5xx, 429, network) with backoff, then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(json(503, {}))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(json(200, { id: 'order_ok' }));
    const pending = provider.createOrder({ amountMinor: 1, currency: 'INR', receipt: 'r', idempotencyKey: 'k' });
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toEqual({ orderId: 'order_ok' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('gives up after three attempts', async () => {
    fetchMock.mockResolvedValue(json(429, {}));
    const pending = provider.createOrder({ amountMinor: 1, currency: 'INR', receipt: 'r', idempotencyKey: 'k' });
    const assertion = expect(pending).rejects.toThrow(/429/);
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry client errors', async () => {
    fetchMock.mockResolvedValueOnce(json(400, { error: 'bad' }));
    await expect(provider.refund({ providerPaymentId: 'pay_1', amountMinor: 100, idempotencyKey: 'rf:1:cc' })).rejects.toThrow(/400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('verifies checkout signatures (order|payment HMAC with the key secret)', () => {
    const signature = hmac(KEY_SECRET, 'order_1|pay_1');
    expect(provider.verifyCheckout({ orderId: 'order_1', paymentId: 'pay_1', signature })).toBe(true);
    expect(provider.verifyCheckout({ orderId: 'order_1', paymentId: 'pay_2', signature })).toBe(false);
    expect(provider.verifyCheckout({ orderId: 'order_1', paymentId: 'pay_1', signature: 'short' })).toBe(false);
  });

  it('verifies webhook signatures over the raw body', () => {
    const body = Buffer.from('{"event":"payment.captured"}');
    expect(provider.verifyWebhook(body, { 'x-razorpay-signature': hmac(WEBHOOK_SECRET, body.toString()) })).toBe(true);
    expect(provider.verifyWebhook(body, { 'x-razorpay-signature': hmac('other', body.toString()) })).toBe(false);
    expect(provider.verifyWebhook(body, {})).toBe(false);
  });

  it.each([
    [
      'payment.captured',
      { payment: { entity: { id: 'pay_1', order_id: 'order_1', amount: 500, currency: 'INR' } } },
      { kind: 'payment.captured', orderId: 'order_1', paymentId: 'pay_1', amountMinor: 500, currency: 'INR' },
    ],
    [
      'payment.failed',
      { payment: { entity: { id: 'pay_1', order_id: 'order_1', amount: 500, currency: 'INR', error_description: 'declined' } } },
      { kind: 'payment.failed', orderId: 'order_1', paymentId: 'pay_1', reason: 'declined' },
    ],
    [
      'refund.processed',
      { refund: { entity: { id: 'rfnd_1', payment_id: 'pay_1', amount: 200 } } },
      { kind: 'refund.processed', refundId: 'rfnd_1', amountMinor: 200 },
    ],
    [
      'refund.failed',
      { refund: { entity: { id: 'rfnd_1', payment_id: 'pay_1', amount: 200 } } },
      { kind: 'refund.failed', refundId: 'rfnd_1' },
    ],
    ['order.paid', {}, { kind: 'ignored', type: 'order.paid' }],
    ['payment.captured', {}, { kind: 'ignored', type: 'payment.captured' }],
  ])('parses %s webhooks', (event, payload, expected) => {
    const parsed = provider.parseWebhook(Buffer.from(JSON.stringify({ event, payload })), { 'x-razorpay-event-id': 'evt_1' });
    expect(parsed).toMatchObject({ eventId: 'evt_1', ...expected });
  });

  it('fetches a payment and reports whether it is captured', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { order_id: 'order_1', amount: 900, currency: 'INR', status: 'captured' }));
    await expect(provider.fetchPayment('pay/1')).resolves.toEqual({
      orderId: 'order_1',
      amountMinor: 900,
      currency: 'INR',
      captured: true,
    });
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.razorpay.com/v1/payments/pay%2F1');
    expect(fetchMock.mock.calls[0]![1]?.body).toBeUndefined();
  });

  it('maps refund status', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { id: 'rfnd_1', status: 'processed' }))
      .mockResolvedValueOnce(json(200, { id: 'rfnd_2', status: 'pending' }));
    await expect(provider.refund({ providerPaymentId: 'pay_1', amountMinor: 100, idempotencyKey: 'k1' })).resolves.toEqual({
      refundId: 'rfnd_1',
      status: 'processed',
    });
    await expect(provider.refund({ providerPaymentId: 'pay_1', amountMinor: 100, idempotencyKey: 'k2' })).resolves.toEqual({
      refundId: 'rfnd_2',
      status: 'pending',
    });
  });

  it.each([
    ['processed', 'processed'],
    ['failed', 'failed'],
    ['created', 'pending'],
  ])('maps fetched refund status %s → %s', async (remote, expected) => {
    fetchMock.mockResolvedValueOnce(json(200, { id: 'rfnd_1', status: remote }));
    await expect(provider.fetchRefund('rfnd/1')).resolves.toEqual({ status: expected });
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.razorpay.com/v1/refunds/rfnd%2F1');
  });
});
