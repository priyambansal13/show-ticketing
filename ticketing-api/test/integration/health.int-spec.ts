/**
 * Boots the real AppModule against real PostgreSQL, MongoDB and Redis and
 * checks the readiness probe — proves the infrastructure wiring end to end.
 */
import type { INestApplication } from '@nestjs/common';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp } from '../../src/bootstrap.js';
import { startMigratedPostgres } from './support/postgres.js';

let pg: StartedPostgreSqlContainer;
let mongo: StartedMongoDBContainer;
let redis: StartedRedisContainer;
let app: INestApplication;

beforeAll(async () => {
  [{ container: pg }, mongo, redis] = await Promise.all([
    startMigratedPostgres(),
    new MongoDBContainer('mongo:8.0').start(),
    new RedisContainer('redis:8-alpine').start(),
  ]);

  Object.assign(process.env, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'warn',
    DATABASE_URL: pg.getConnectionUri(),
    MONGO_URL: `${mongo.getConnectionString()}/ticketing?directConnection=true`,
    REDIS_URL: redis.getConnectionUrl(),
    KAFKA_BROKERS: 'localhost:19092',
    SMTP_HOST: 'localhost',
    SMTP_PORT: '1025',
    JWT_ACCESS_SECRET: 'int-jwt-secret-0123456789abcdefghijklmnopqrstuv',
    TICKET_SIGNING_SECRET: 'int-ticket-secret-0123456789abcdefghijklmnopq',
    // This suite checks the data-store probes only: no Kafka relay, no queue workers.
    OUTBOX_RELAY_ENABLED: 'false',
    WORKERS_ENABLED: 'false',
  });

  // Imported after the environment is set: ConfigModule validates env at import time.
  const { AppModule } = await import('../../src/app.module.js');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ rawBody: true });
  configureApp(app);
  await app.init();
});

afterAll(async () => {
  await app?.close();
  await Promise.all([pg?.stop(), mongo?.stop(), redis?.stop()]);
});

describe('GET /api/v1/health', () => {
  it('live → 200', async () => {
    await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);
  });

  it('ready → 200 with every data store up', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);
    expect(res.body.status).toBe('ok');
    expect(Object.keys(res.body.details).sort()).toEqual(['mongodb', 'postgres', 'redis']);
    for (const check of Object.values(res.body.details) as Array<{ status: string }>) {
      expect(check.status).toBe('up');
    }
  });

  it('propagates a caller-supplied x-request-id', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/live').set('x-request-id', 'trace-123');
    expect(res.headers['x-request-id']).toBe('trace-123');
  });

  it('replaces an unsafe x-request-id with a generated one', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/live').set('x-request-id', 'bad id<>');
    expect(res.headers['x-request-id']).not.toBe('bad id<>');
  });

  it('applies the configured CORS origin', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/live').set('Origin', 'http://localhost:3000');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  it('reports 503 with status only — no hosts, ports or driver messages — when a store is down', async () => {
    await redis.stop();
    // Results are cached for 2 s; poll until the failure is observed.
    let res: request.Response | undefined;
    await vi.waitFor(
      async () => {
        res = await request(app.getHttpServer()).get('/api/v1/health/ready');
        expect(res.status).toBe(503);
      },
      { timeout: 15_000, interval: 500 },
    );
    expect(res!.body.error).toEqual({ redis: { status: 'down' } });
    expect(JSON.stringify(res!.body)).not.toMatch(/\d+\.\d+\.\d+\.\d+|localhost|:\d{2,5}|ECONN|message/i);
  });
});
