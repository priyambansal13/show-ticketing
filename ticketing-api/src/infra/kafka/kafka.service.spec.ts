import type { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import type { EachMessagePayload } from 'kafkajs';
import type { MetricsService } from '../metrics/metrics.service.js';
import { dlqTopic, KafkaService } from './kafka.service.js';

/** In-memory Redis subset used by the consumer wrapper. */
function memoryRedis() {
  const store = new Map<string, string>();
  return {
    exists: vi.fn(async (key: string) => (store.has(key) ? 1 : 0)),
    set: vi.fn(async (key: string, value: string) => (store.set(key, value), 'OK')),
    incr: vi.fn(async (key: string) => {
      const next = Number(store.get(key) ?? 0) + 1;
      store.set(key, String(next));
      return next;
    }),
    expire: vi.fn(async () => 1),
  } as unknown as Redis;
}

const counter = () => ({ inc: vi.fn() });

async function consumerHarness(handler: (m: unknown) => Promise<void>) {
  const config = {
    get: (key: string) => ({ OUTBOX_RELAY_ENABLED: true, KAFKA_CLIENT_ID: 'test', KAFKA_BROKERS: ['localhost:1'] })[key],
  } as unknown as ConfigService<never, true>;
  const metrics = { consumed: counter() } as unknown as MetricsService;
  const service = new KafkaService(config as never, memoryRedis(), metrics);
  let eachMessage: ((p: EachMessagePayload) => Promise<void>) | undefined;
  const consumer = {
    connect: vi.fn(),
    subscribe: vi.fn(),
    run: vi.fn(async (opts: { eachMessage: typeof eachMessage }) => void (eachMessage = opts.eachMessage)),
    disconnect: vi.fn(),
  };
  Object.assign(service, { kafka: { consumer: () => consumer } });
  const send = vi.spyOn(service, 'send').mockResolvedValue();
  await service.consume('group', ['booking.confirmed'], handler);
  const deliver = (value: string, outboxId = '42') =>
    eachMessage!({
      topic: 'booking.confirmed',
      partition: 0,
      message: { key: Buffer.from('k'), value: Buffer.from(value), offset: '7', headers: { outboxId: Buffer.from(outboxId) } },
    } as unknown as EachMessagePayload);
  return { deliver, send, metrics };
}

describe('KafkaService consumer wrapper', () => {
  it('handles a message once and skips redeliveries (dedupe on outbox id)', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const { deliver } = await consumerHarness(handler);
    await deliver('{"a":1}');
    await deliver('{"a":1}');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('retries a failing handler, then moves the message to the DLQ', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('smtp down'));
    const { deliver, send } = await consumerHarness(handler);
    for (let attempt = 1; attempt < 5; attempt++) await expect(deliver('{"a":1}')).rejects.toThrow('smtp down');
    await expect(deliver('{"a":1}')).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledWith(dlqTopic('booking.confirmed'), [
      expect.objectContaining({ headers: expect.objectContaining({ group: 'group' }) }),
    ]);
    await deliver('{"a":1}'); // already dead-lettered → skipped
    expect(handler).toHaveBeenCalledTimes(5);
  });

  it('dead-letters unparseable messages immediately', async () => {
    const handler = vi.fn();
    const { deliver, send } = await consumerHarness(handler);
    await deliver('{not json', '43');
    expect(handler).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith('booking.confirmed.dlq', expect.any(Array));
  });
});
