---
name: observability
description: Logging, metrics, tracing, health checks and error-handling standards for ticketing-api and ticketing-web. Use when adding a module, endpoint, consumer, background job, or external integration.
---

# Observability standards

## Logging (pino via `nestjs-pino`)
- JSON logs only; fields: `level, time, msg, requestId, userId?, role?, module, route, durationMs, errorCode?`.
- `requestId`: accept `X-Request-Id` from NGINX or generate (UUID v7); return it in the response header; propagate into Kafka message headers and BullMQ job data so consumer logs correlate.
- Levels: `error` = needs action (5xx, failed consumer after retries); `warn` = handled anomaly (409 seat conflict spike, payment retry); `info` = business events (booking confirmed); `debug` = dev only.
- Redact: `req.headers.authorization`, `req.headers.cookie`, `*.password`, `*.token`, `*.refreshToken`, `*.otp`, payment instrument fields.
- Never log full request bodies for auth/payment routes.

## Metrics (`prom-client`, exposed at `/metrics`, internal only)
Default HTTP metrics: `http_request_duration_seconds{method,route,status}` histogram (recorded on response `finish`, so error statuses and guard rejections are included; its `_count` is the request counter). Implemented in `ticketing-api/src/infra/metrics/`.

Business metrics (required):
| Metric | Type | Labels |
|---|---|---|
| `seat_hold_attempts_total` | counter | `result=success|conflict|error` |
| `seat_hold_duration_seconds` | histogram | — |
| `bookings_total` | counter | `status=confirmed|expired|failed|cancelled` |
| `payments_total` | counter | `provider, outcome` (settlement outcome: confirmed, duplicate_refunded, …, failed) |
| `payment_anomalies_total` | counter | `kind` (e.g. amount_mismatch — manual review) |
| `refund_failures_total` | counter | — |
| `payment_webhook_lag_seconds` | histogram | `provider` — *not yet implemented (plan §11)* |
| `outbox_events` | gauge | `status` = PENDING / FAILED (read at scrape) |
| `kafka_messages_consumed_total` | counter | `group, result` (ok / retry / dead_lettered) |
| `kafka_consumer_lag` | gauge | `topic, group` — *not yet implemented (plan §11)* |
| `bullmq_jobs_total` | counter | `queue, result` |
| `ws_connections` | gauge | `namespace` |

Label rule: never use unbounded values (userId, showId, bookingId) as labels.

## Tracing
- OpenTelemetry SDK (HTTP, Prisma, Mongoose, ioredis, KafkaJS instrumentations), OTLP exporter configurable via env; disabled by default locally. Trace id = log `traceId`.

## Health
- `GET /health/live` — process up. `GET /health/ready` — Postgres, Mongo, Redis, Kafka reachable (`@nestjs/terminus`). Readiness fails → K8s stops routing.

## Error handling
- Global exception filter maps everything to `{ error: { code, message, details } }` + `requestId`.
- Unknown errors → 500 `INTERNAL_ERROR`, logged at `error` with stack; message to client is generic.
- External calls (payment provider, SES, Twilio): timeout (≤ 5 s), retry with exponential backoff + jitter (max 3), circuit breaker for sustained failure; failures after retries go to a DLQ topic (`<topic>.dlq`).

## Frontend
- `error.tsx` boundaries per route group; report client errors to the API `/client-errors` endpoint (rate-limited) or Sentry if configured.
- Web Vitals reported via `useReportWebVitals`.

## Checklist
- [ ] New endpoint/consumer/job logs with requestId and has duration metric
- [ ] New business event has a counter
- [ ] External call has timeout + retry + DLQ
- [ ] No sensitive fields logged (verify redact paths)
