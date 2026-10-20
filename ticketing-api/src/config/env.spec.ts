import { validateEnv } from './env.js';

const valid = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  MONGO_URL: 'mongodb://localhost:27017/db',
  REDIS_URL: 'redis://localhost:6379',
  KAFKA_BROKERS: 'localhost:19092, localhost:19093',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
  TICKET_SIGNING_SECRET: 'y'.repeat(32),
};

describe('validateEnv', () => {
  it('parses a valid environment and applies defaults', () => {
    const env = validateEnv(valid);
    expect(env.DATABASE_POOL_MAX).toBe(10);
    expect(env.DATABASE_POOL_TIMEOUT_MS).toBe(5000);
    expect(env.PORT).toBe(4000);
    expect(env.SMTP_PORT).toBe(1025);
    expect(env.KAFKA_BROKERS).toEqual(['localhost:19092', 'localhost:19093']);
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:3000']);
  });

  it('splits CORS_ORIGINS and drops empty entries', () => {
    const env = validateEnv({ ...valid, CORS_ORIGINS: 'https://a.example, ,https://b.example' });
    expect(env.CORS_ORIGINS).toEqual(['https://a.example', 'https://b.example']);
  });

  it('requires NODE_ENV (no silent dev default)', () => {
    const { NODE_ENV: _omit, ...withoutNodeEnv } = valid;
    expect(() => validateEnv(withoutNodeEnv)).toThrow(/NODE_ENV/);
  });

  it.each(['*', 'not a url', 'ftp://files.example'])('rejects CORS origin "%s"', (origin) => {
    expect(() => validateEnv({ ...valid, CORS_ORIGINS: origin })).toThrow(/CORS_ORIGINS/);
  });

  it('rejects an empty broker list', () => {
    expect(() => validateEnv({ ...valid, KAFKA_BROKERS: ' , ' })).toThrow(/KAFKA_BROKERS/);
  });

  it('requires Razorpay credentials when PAYMENT_PROVIDER=razorpay', () => {
    expect(() => validateEnv({ ...valid, PAYMENT_PROVIDER: 'razorpay' })).toThrow(
      /RAZORPAY_KEY_ID[\s\S]*RAZORPAY_KEY_SECRET[\s\S]*RAZORPAY_WEBHOOK_SECRET/,
    );
  });

  it('refuses the fake payment provider and manager auto-approval in production', () => {
    expect(() => validateEnv({ ...valid, NODE_ENV: 'production', MANAGER_AUTO_APPROVE: 'true' })).toThrow(
      /PAYMENT_PROVIDER[\s\S]*MANAGER_AUTO_APPROVE/,
    );
  });

  it('rejects short signing secrets', () => {
    expect(() => validateEnv({ ...valid, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('rejects a wrong database protocol', () => {
    expect(() => validateEnv({ ...valid, DATABASE_URL: 'mysql://u:p@localhost/db' })).toThrow(/DATABASE_URL/);
  });

  it('lists every missing variable', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL[\s\S]*MONGO_URL[\s\S]*REDIS_URL/);
  });

  it('never echoes secret values in the error', () => {
    const secret = 'postgresql://user:SuperSecret@localhost:99999/db';
    try {
      validateEnv({ ...valid, DATABASE_URL: secret, PORT: 'not-a-port' });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain('SuperSecret');
    }
  });
});

describe('.env.example', () => {
  it('is a valid configuration as shipped (empty optional values are treated as unset)', async () => {
    const { readFileSync } = await import('node:fs');
    const raw = Object.fromEntries(
      readFileSync(new URL('../../.env.example', import.meta.url), 'utf8')
        .split('\n')
        .filter((line) => line.trim() && !line.startsWith('#'))
        .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
    );
    const env = validateEnv(raw);
    expect(env.METRICS_TOKEN).toBeUndefined();
  });
});
