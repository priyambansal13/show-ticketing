import { randomUUID } from 'node:crypto';
import { maskEmail } from './booking.service.js';
import { createTicketCode, verifyTicketCode } from './ticket-code.js';

const SECRET = 's'.repeat(32);

describe('ticket codes', () => {
  const bookingId = randomUUID();

  it('round-trips a signed code', () => {
    const code = createTicketCode(SECRET, bookingId);
    expect(code).toMatch(/^TKT1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{32}$/);
    expect(verifyTicketCode(SECRET, code)).toBe(bookingId);
  });

  it.each([
    ['wrong secret', () => createTicketCode('x'.repeat(32), bookingId)],
    ['tampered booking id', () => createTicketCode(SECRET, bookingId).replace(bookingId, randomUUID())],
    ['truncated signature', () => createTicketCode(SECRET, bookingId).slice(0, -3)],
    ['wrong prefix', () => createTicketCode(SECRET, bookingId).replace('TKT1', 'TKT2')],
    ['not a uuid', () => 'TKT1.not-a-uuid.sig'],
    ['missing parts', () => 'TKT1'],
  ])('rejects %s', (_label, code) => {
    expect(verifyTicketCode(SECRET, code())).toBeNull();
  });
});

describe('maskEmail', () => {
  it.each([
    ['jane@example.com', 'j***@example.com'],
    ['x@y.io', 'x***@y.io'],
    ['broken', 'b***@'],
  ])('%s → %s', (input, expected) => {
    expect(maskEmail(input)).toBe(expected);
  });
});

describe('BookingService settlement guards', () => {
  it('refuses to confirm a booking that is not PENDING', async () => {
    const { BookingService } = await import('./booking.service.js');
    const service = Object.create(BookingService.prototype) as InstanceType<typeof BookingService>;
    const tx = { $queryRaw: vi.fn().mockResolvedValue([]) };
    await expect(service.confirmInTx(tx as never, randomUUID())).rejects.toThrow(/is not PENDING/);
  });
});

describe('PaymentService.fakeCheckout', () => {
  it('is unavailable with a real provider', async () => {
    const { PaymentService } = await import('../payment/payment.service.js');
    const service = Object.create(PaymentService.prototype) as InstanceType<typeof PaymentService>;
    Object.assign(service, { provider: { name: 'razorpay' } });
    await expect(service.fakeCheckout({ id: 'u', role: 'CUSTOMER', status: 'ACTIVE' }, 'order_1')).rejects.toThrow(/not found/i);
  });
});

describe('createPaymentProvider', () => {
  it('fails loudly when Razorpay credentials are missing', async () => {
    const { createPaymentProvider } = await import('../payment/payment.module.js');
    const config = { get: (key: string) => (key === 'PAYMENT_PROVIDER' ? 'razorpay' : undefined) };
    expect(() => createPaymentProvider(config as never)).toThrow(/credentials are not configured/);
  });
});
