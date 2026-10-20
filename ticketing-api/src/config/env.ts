import { z } from 'zod';

const booleanFlag = z.enum(['true', 'false']).transform((value) => value === 'true');

const csv = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

/**
 * Every environment variable the API reads. Validated once at startup so a
 * misconfigured deployment fails fast instead of at first use.
 * Document new variables in .env.example as well.
 */
export const envSchema = z
  .object({
    // Required on purpose: a deployment that forgets it must not silently run with dev behaviour.
    NODE_ENV: z.enum(['development', 'test', 'production']),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    /**
     * Express `trust proxy`: how many reverse-proxy hops to trust for X-Forwarded-For
     * (client IP for rate limits and audit). 0 = trust none (direct exposure).
     */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    /** If set, GET /metrics requires `Authorization: Bearer <token>`. */
    METRICS_TOKEN: z.preprocess((value) => (value === '' ? undefined : value), z.string().min(16).optional()),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    // Explicit origins only — '*' is invalid with credentialed CORS.
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:3000')
      .transform(csv)
      .pipe(z.array(z.url({ protocol: /^https?$/ })).min(1)),

    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    /** Connections per API instance (pg pool size). */
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(200).default(10),
    /** Fail fast with an error instead of queueing forever when the pool is exhausted. */
    DATABASE_POOL_TIMEOUT_MS: z.coerce.number().int().min(100).default(5000),
    /** Server-side cap on any single statement. */
    DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(100).default(5000),

    MONGO_URL: z.url({ protocol: /^mongodb(\+srv)?$/ }),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),
    KAFKA_BROKERS: z
      .string()
      .min(1)
      .transform(csv)
      .pipe(z.array(z.string().min(1)).min(1)),
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    /** Require STARTTLS (mandatory in production — mails carry PII and ticket codes). */
    SMTP_REQUIRE_TLS: booleanFlag.default(false),
    MAIL_FROM: z.string().min(3).default('Ticketing <no-reply@ticketing.local>'),

    // ── Auth ──
    /** HS256 signing secret for access tokens — at least 256 bits. */
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
    /** Dev convenience: new managers become ACTIVE immediately instead of awaiting admin approval. */
    MANAGER_AUTO_APPROVE: booleanFlag.default(false),

    // ── Booking policy ──
    SEAT_HOLD_TTL_SECONDS: z.coerce.number().int().min(30).max(1800).default(300),
    MAX_SEATS_PER_BOOKING: z.coerce.number().int().min(1).max(50).default(10),
    MAX_ACTIVE_HOLDS_PER_USER: z.coerce.number().int().min(1).max(10).default(2),
    CANCELLATION_CUTOFF_HOURS: z.coerce.number().int().min(0).max(168).default(4),
    /** Percentage of the booking total kept as a fee on customer cancellation (0–100). */
    CANCELLATION_FEE_PERCENT: z.coerce.number().int().min(0).max(100).default(10),

    // ── Background processing ──
    /** Run queue workers (hold expiry, refunds) in this process. Disable on API-only instances. */
    WORKERS_ENABLED: booleanFlag.default(true),
    /** Relay outbox → Kafka and run Kafka consumers (audit, notifications) in this process. */
    OUTBOX_RELAY_ENABLED: booleanFlag.default(true),
    KAFKA_CLIENT_ID: z.string().min(1).default('ticketing-api'),
    /** Signs ticket QR payloads (HMAC). At least 256 bits. */
    TICKET_SIGNING_SECRET: z.string().min(32),

    // ── Payments ──
    /** `fake` signs payments locally (dev/test); `razorpay` talks to Razorpay. */
    PAYMENT_PROVIDER: z.enum(['fake', 'razorpay']).default('fake'),
    FAKE_PAYMENT_SECRET: z.string().min(16).default('fake-payment-secret-dev-only'),
    RAZORPAY_KEY_ID: z.string().optional(),
    RAZORPAY_KEY_SECRET: z.string().optional(),
    RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.PAYMENT_PROVIDER === 'razorpay') {
      for (const key of ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'] as const) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'required when PAYMENT_PROVIDER=razorpay' });
      }
    }
    if (env.NODE_ENV === 'production') {
      if (env.PAYMENT_PROVIDER === 'fake') {
        ctx.addIssue({ code: 'custom', path: ['PAYMENT_PROVIDER'], message: 'fake provider is not allowed in production' });
      }
      if (env.MANAGER_AUTO_APPROVE) {
        ctx.addIssue({ code: 'custom', path: ['MANAGER_AUTO_APPROVE'], message: 'must be false in production' });
      }
      if (!env.SMTP_REQUIRE_TLS) {
        ctx.addIssue({ code: 'custom', path: ['SMTP_REQUIRE_TLS'], message: 'must be true in production' });
      }
      if (!env.METRICS_TOKEN) {
        ctx.addIssue({ code: 'custom', path: ['METRICS_TOKEN'], message: 'required in production' });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    // Never echo values — they may be secrets. Field paths and reasons are enough.
    const issues = result.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid environment configuration:\n${issues.join('\n')}`);
  }
  return result.data;
}
