import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const PRISMA_BIN = resolve(import.meta.dirname, '../../../node_modules/.bin/prisma');

/** Starts PostgreSQL 17 and applies every migration exactly as production does (`migrate deploy`). */
export async function startMigratedPostgres(): Promise<{ container: StartedPostgreSqlContainer; url: string }> {
  const container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const url = container.getConnectionUri();
  execFileSync(PRISMA_BIN, ['migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
  return { container, url };
}
