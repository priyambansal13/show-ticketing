/**
 * Starts the real infrastructure once for the whole e2e run and shares the
 * connection details with every test file (vitest `provide` / `inject`).
 */
import { MongoDBContainer } from '@testcontainers/mongodb';
import { RedisContainer } from '@testcontainers/redis';
import { RedpandaContainer } from '@testcontainers/redpanda';
import { GenericContainer, Wait } from 'testcontainers';
import type { TestProject } from 'vitest/node';
import { startMigratedPostgres } from '../../integration/support/postgres.js';

declare module 'vitest' {
  export interface ProvidedContext {
    infra: {
      databaseUrl: string;
      mongoUrl: string;
      redisUrl: string;
      kafkaBrokers: string;
      smtpHost: string;
      smtpPort: number;
      mailpitApi: string;
    };
  }
}

export default async function setup(project: TestProject) {
  const [{ container: pg, url }, mongo, redis, redpanda, mailpit] = await Promise.all([
    startMigratedPostgres(),
    new MongoDBContainer('mongo:8.0').start(),
    new RedisContainer('redis:8-alpine').start(),
    new RedpandaContainer('redpandadata/redpanda:v26.2.4').start(),
    new GenericContainer('axllent/mailpit:v1.31.5').withExposedPorts(1025, 8025).withWaitStrategy(Wait.forHttp('/livez', 8025)).start(),
  ]);

  project.provide('infra', {
    databaseUrl: url,
    mongoUrl: `${mongo.getConnectionString()}/ticketing?directConnection=true`,
    redisUrl: redis.getConnectionUrl(),
    kafkaBrokers: redpanda.getBootstrapServers(),
    smtpHost: mailpit.getHost(),
    smtpPort: mailpit.getMappedPort(1025),
    mailpitApi: `http://${mailpit.getHost()}:${mailpit.getMappedPort(8025)}/api/v1`,
  });

  return async () => {
    await Promise.allSettled([pg.stop(), mongo.stop(), redis.stop(), redpanda.stop(), mailpit.stop()]);
  };
}
