import { BeforeApplicationShutdown, Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { Kafka, logLevel, Partitioners, type Consumer, type Message, type Producer } from 'kafkajs';
import type { Env } from '../../config/env.js';
import { MetricsService } from '../metrics/metrics.service.js';
import { TOPICS } from '../outbox/outbox.service.js';
import { REDIS } from '../redis/redis.module.js';

export interface ConsumedMessage<T> {
  topic: string;
  key: string | null;
  value: T;
  outboxId: string | null;
  requestId: string | null;
}

const DEDUPE_TTL_SECONDS = 7 * 86_400;
/** A message whose handler keeps failing goes to `<topic>.dlq` after this many attempts. */
const MAX_HANDLER_ATTEMPTS = 5;
export const dlqTopic = (topic: string) => `${topic}.dlq`;

/**
 * Kafka (Redpanda locally) producer and consumer groups. Delivery is
 * at-least-once; consumers dedupe on the outbox id header so handlers run once
 * per event per consumer group.
 */
@Injectable()
export class KafkaService implements OnModuleInit, BeforeApplicationShutdown, OnApplicationShutdown {
  private readonly logger = new Logger(KafkaService.name);
  private readonly kafka: Kafka;
  private readonly consumers: Consumer[] = [];
  private producer?: Producer;
  readonly enabled: boolean;

  constructor(
    config: ConfigService<Env, true>,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly metrics: MetricsService,
  ) {
    this.enabled = config.get('OUTBOX_RELAY_ENABLED', { infer: true });
    this.kafka = new Kafka({
      clientId: config.get('KAFKA_CLIENT_ID', { infer: true }),
      brokers: config.get('KAFKA_BROKERS', { infer: true }),
      logLevel: logLevel.ERROR,
      // Worst case ≈ 30 s — below the outbox lease (90 s), so a slow send is not re-claimed by another relay.
      retry: { retries: 5, initialRetryTime: 300, maxRetryTime: 10_000 },
    });
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) return;
    const admin = this.kafka.admin();
    try {
      await admin.connect();
      const existing = new Set(await admin.listTopics());
      const wanted = Object.values(TOPICS).flatMap((topic) => [topic, dlqTopic(topic)]);
      const missing = wanted.filter((topic) => !existing.has(topic));
      if (missing.length > 0) {
        await admin.createTopics({
          waitForLeaders: true,
          topics: missing.map((topic) => ({ topic, numPartitions: 3, replicationFactor: 1 })),
        });
      }
    } finally {
      await admin.disconnect();
    }
    this.producer = this.kafka.producer({ idempotent: true, maxInFlightRequests: 1, createPartitioner: Partitioners.DefaultPartitioner });
    await this.producer.connect();
  }

  async send(topic: string, messages: Message[]): Promise<void> {
    if (!this.producer) throw new Error('Kafka producer not connected');
    await this.producer.send({ topic, messages, acks: -1 });
  }

  /**
   * Starts a consumer group. A failing handler is retried (kafkajs restarts the
   * partition with back-off); after MAX_HANDLER_ATTEMPTS — or immediately for an
   * unparseable message — the message is moved to `<topic>.dlq` so one poison
   * message never blocks the partition.
   */
  async consume<T>(groupId: string, topics: string[], handler: (message: ConsumedMessage<T>) => Promise<void>): Promise<void> {
    if (!this.enabled) return;
    const consumer = this.kafka.consumer({ groupId, allowAutoTopicCreation: false });
    await consumer.connect();
    await consumer.subscribe({ topics, fromBeginning: true });
    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        const outboxId = message.headers?.['outboxId']?.toString() ?? null;
        const messageId = outboxId ?? `${topic}:${partition}:${message.offset}`;
        const dedupeKey = `consumed:${groupId}:${messageId}`;
        if (await this.redis.exists(dedupeKey)) return;

        let value: T;
        try {
          value = JSON.parse(message.value?.toString() ?? 'null') as T;
        } catch (error) {
          await this.deadLetter(groupId, topic, message.key, message.value, error);
          await this.redis.set(dedupeKey, '1', 'EX', DEDUPE_TTL_SECONDS);
          return;
        }
        try {
          await handler({
            topic,
            key: message.key?.toString() ?? null,
            value,
            outboxId,
            requestId: message.headers?.['requestId']?.toString() ?? null,
          });
          this.metrics.consumed.inc({ group: groupId, result: 'ok' });
        } catch (error) {
          const attemptsKey = `consume-attempts:${groupId}:${messageId}`;
          const attempts = await this.redis.incr(attemptsKey);
          await this.redis.expire(attemptsKey, 86_400);
          if (attempts < MAX_HANDLER_ATTEMPTS) {
            this.metrics.consumed.inc({ group: groupId, result: 'retry' });
            throw error; // kafkajs retries this message
          }
          await this.deadLetter(groupId, topic, message.key, message.value, error);
        }
        await this.redis.set(dedupeKey, '1', 'EX', DEDUPE_TTL_SECONDS);
      },
    });
    this.consumers.push(consumer);
    this.logger.log({ groupId, topics }, 'Kafka consumer started');
  }

  private async deadLetter(groupId: string, topic: string, key: Buffer | null, value: Buffer | null, error: unknown) {
    await this.send(dlqTopic(topic), [{ key, value, headers: { group: groupId, error: String(error).slice(0, 500) } }]);
    this.metrics.consumed.inc({ group: groupId, result: 'dead_lettered' });
    this.logger.error({ err: error, groupId, topic }, 'Message moved to dead-letter topic');
  }

  async ping(): Promise<void> {
    const admin = this.kafka.admin();
    await admin.connect();
    try {
      await admin.describeCluster();
    } finally {
      await admin.disconnect();
    }
  }

  /** Consumers stop first (in-flight handlers finish while PostgreSQL/Redis are still up). */
  async beforeApplicationShutdown(): Promise<void> {
    await Promise.allSettled(this.consumers.map((c) => c.disconnect()));
  }

  /** The producer closes last — after the outbox relay has stopped (its beforeApplicationShutdown). */
  async onApplicationShutdown(): Promise<void> {
    await this.producer?.disconnect().catch(() => undefined);
  }
}
