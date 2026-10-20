import type { KafkaService } from '../kafka/kafka.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { OutboxRelayService } from './outbox-relay.service.js';

const row = (id: number, attempts = 0) => ({ id: BigInt(id), topic: 't', aggregate_id: `a${id}`, payload: {}, headers: null, attempts });
const sqlOf = (call: unknown[]) => (call[0] as TemplateStringsArray).join('?');

function harness(
  rows: ReturnType<typeof row>[],
  send: (topic: string, messages: Array<{ headers: { outboxId: string } }>) => Promise<void>,
) {
  const prisma = { $queryRaw: vi.fn().mockResolvedValue(rows), $executeRaw: vi.fn().mockResolvedValue(1) };
  const kafka = { enabled: true, send: vi.fn(send) };
  const relay = new OutboxRelayService(prisma as unknown as PrismaService, kafka as unknown as KafkaService);
  return { relay, prisma };
}

const retriable = Object.assign(new Error('broker unreachable'), { retriable: true });
const fatal = Object.assign(new Error('invalid topic'), { retriable: false });

describe('OutboxRelayService', () => {
  it('sends a whole batch and marks it SENT', async () => {
    const { relay, prisma } = harness([row(1), row(2)], async () => undefined);
    await expect(relay.relayBatch()).resolves.toBe(2);
    expect(sqlOf(prisma.$executeRaw.mock.calls[0]!)).toContain("status = 'SENT'");
  });

  it('spends no attempts while the broker is down — rows wait and the loop backs off', async () => {
    const send = vi.fn(async () => Promise.reject(retriable));
    const { relay, prisma } = harness([row(1, 9), row(2, 9), row(3, 9)], send);
    await expect(relay.relayBatch()).rejects.toThrow(/Kafka unavailable/);
    expect(send).toHaveBeenCalledTimes(2); // the batch, then one probe — not every row
    const sql = prisma.$executeRaw.mock.calls.map(sqlOf);
    expect(sql.some((s) => s.includes("status = 'FAILED'"))).toBe(false);
    expect(sql.some((s) => s.includes('attempts ='))).toBe(false);
  });

  it('parks only the row Kafka rejects, after its attempts are spent, while others go out', async () => {
    const { relay, prisma } = harness([row(1, 9), row(2, 0)], async (_topic, messages) => {
      if (messages.some((m) => m.headers.outboxId === '1')) throw fatal;
    });
    await expect(relay.relayBatch()).resolves.toBe(1);
    const sql = prisma.$executeRaw.mock.calls.map(sqlOf);
    expect(sql.filter((s) => s.includes("status = 'FAILED'"))).toHaveLength(1);
    expect(sql.filter((s) => s.includes("status = 'SENT'"))).toHaveLength(1);
  });

  it('backs off a row-specific failure that still has attempts left', async () => {
    const { relay, prisma } = harness([row(1, 0), row(2, 0)], async (_topic, messages) => {
      if (messages.some((m) => m.headers.outboxId === '1')) throw fatal;
    });
    await relay.relayBatch();
    const sql = prisma.$executeRaw.mock.calls.map(sqlOf);
    expect(sql.some((s) => s.includes('attempts = ?') && s.includes('claimed_until = now() + make_interval'))).toBe(true);
  });

  it('does nothing when there are no pending rows', async () => {
    const { relay, prisma } = harness([], async () => undefined);
    await expect(relay.relayBatch()).resolves.toBe(0);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
});
