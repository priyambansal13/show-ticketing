import { randomUUID } from 'node:crypto';
import type { OutboxService } from '../../infra/outbox/outbox.service.js';
import { RefundRequests } from './refund-requests.js';

describe('RefundRequests', () => {
  const outbox = { add: vi.fn() } as unknown as OutboxService & { add: ReturnType<typeof vi.fn> };
  const requests = new RefundRequests(outbox, {} as never);
  const input = { paymentId: randomUUID(), bookingId: randomUUID(), amount: '100.00', reason: 'late_payment_seats_taken' as const };

  beforeEach(() => vi.clearAllMocks());

  it('creates one refund per (payment, reason) with a key that fits the column', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'r1' });
    const tx = { refund: { findUnique: vi.fn().mockResolvedValue(null), create }, outboxEvent: {} };
    expect(await requests.request(tx as never, input)).toBe('r1');
    const key = create.mock.calls[0]![0].data.idempotencyKey as string;
    expect(key).toBe(`rf:${input.paymentId}:lp`);
    expect(key.length).toBeLessThanOrEqual(64);
    expect(outbox.add).toHaveBeenCalledTimes(1);
  });

  it('returns the existing refund for a repeated request without side effects', async () => {
    const tx = { refund: { findUnique: vi.fn().mockResolvedValue({ id: 'existing' }), create: vi.fn() }, outboxEvent: {} };
    expect(await requests.request(tx as never, input)).toBe('existing');
    expect(tx.refund.create).not.toHaveBeenCalled();
    expect(outbox.add).not.toHaveBeenCalled();
  });
});
