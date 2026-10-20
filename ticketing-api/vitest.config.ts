import { defineConfig } from 'vitest/config';

/**
 * Three suites, one coverage report:
 *   unit — pure logic, no I/O                         (pnpm test)
 *   int  — components against real containers         (pnpm test:int)
 *   e2e  — the whole app over HTTP/WebSocket against   (pnpm test:e2e)
 *          PostgreSQL, MongoDB, Redis, Redpanda, Mailpit
 * `pnpm test:cov` runs all three and enforces the definition-of-done thresholds.
 * Container suites need a running Docker daemon.
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    // Container-heavy suites: run files one at a time to bound resource use.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/generated/**', 'src/main.ts', 'src/**/*.spec.ts'],
      thresholds: {
        lines: 80,
        branches: 75,
        'src/modules/{inventory,booking,payment}/**': { lines: 95, branches: 90 },
      },
    },
    projects: [
      { extends: true, test: { name: 'unit', include: ['src/**/*.spec.ts'] } },
      {
        extends: true,
        test: { name: 'int', include: ['test/integration/**/*.int-spec.ts'], testTimeout: 60_000, hookTimeout: 180_000 },
      },
      {
        extends: true,
        test: {
          name: 'e2e',
          include: ['test/e2e/**/*.e2e-spec.ts'],
          globalSetup: ['test/e2e/support/global-setup.ts'],
          testTimeout: 60_000,
          hookTimeout: 240_000,
        },
      },
    ],
  },
});
