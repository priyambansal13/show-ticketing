# ticketing-api

NestJS 12 API of the BookMyShow-style ticketing platform.

**Setup, run commands, URLs, demo accounts and troubleshooting: see the main guide → [`../README.md`](../README.md).**

## Quick start

```bash
nvm use && pnpm install && cp .env.example .env
pnpm infra:up && pnpm db:deploy && pnpm db:seed
pnpm start:dev        # http://localhost:4000/api/docs
```

## What each command starts

`pnpm infra:up` starts only the databases and the email catcher — not the browser tools, the API or Prisma Studio.

| Command | Starts | Address | Opens in a browser? |
|---|---|---|---|
| `pnpm infra:up` | PostgreSQL | `localhost:5432` | No — database port |
| | MongoDB | `localhost:27017` | No — database port |
| | Redis | `localhost:6379` | No — database port |
| | Redpanda (Kafka) | `localhost:19092` | No — message broker port |
| | Mailpit (catches all emails) | http://localhost:8025 | **Yes** |
| `pnpm infra:tools` | everything `infra:up` starts, **plus:** | | |
| | mongo-express (MongoDB browser) | http://localhost:8081 | **Yes** (`dev` / `dev`) |
| | RedisInsight (Redis browser) | http://localhost:5540 | **Yes** |
| | Redpanda Console (Kafka browser) | http://localhost:8080 | **Yes** |
| `pnpm start:dev` | the API | http://localhost:4000/api/docs | **Yes** |
| `pnpm db:studio` | Prisma Studio (PostgreSQL browser) | http://localhost:5555 | **Yes** |

- `infra:up` / `infra:tools` start Docker containers in the background and return once they are healthy; they keep running until `pnpm infra:down`.
- `start:dev` / `db:studio` run in your terminal and stop on `Ctrl+C` or when the terminal closes.
- Every URL working = `pnpm infra:tools` once, plus `pnpm start:dev` and `pnpm db:studio` in their own terminals.
- `http://localhost:4000` alone is a 404 — use `/api/docs` or `/api/v1/...`. Use `http://`, not `https://`.

Kafka: browse topics, messages and consumer groups in Redpanda Console (http://localhost:8080), or `docker compose exec redpanda rpk topic consume booking.confirmed -n 5`.

Desktop database clients: Postgres `postgresql://ticketing:ticketing@localhost:5432/ticketing` · MongoDB `mongodb://localhost:27017/ticketing?replicaSet=rs0&directConnection=true` · Redis `localhost:6379` (no password) · Kafka `localhost:19092`.

Demo logins (after `pnpm db:seed`): `admin@ticketing.local` / `ChangeMe!Admin123` · `manager@ticketing.local` / `ChangeMe!Manager123` · `customer@ticketing.local` / `ChangeMe!Customer123`.

## Layout

```
src/
  config/            zod-validated environment (env.ts)
  common/            auth decorators, errors + global filter, validation (zod → OpenAPI), idempotency, rate limit
  infra/             prisma, mongo, redis, kafka + outbox relay, BullMQ queues + housekeeping, metrics, socket.io adapter
  modules/
    auth, users, admin        logins (customer / manager / admin), refresh tokens, manager approval
    events                    venues, seat layouts, events, shows (MongoDB) — manager CRUD + public catalog
    inventory                 show seats, Redis holds, live seat updates (WebSocket /seats)
    booking                   holds, expiry, confirmation, cancellation, show cancellation, tickets, reports
    payment, ledger           payment providers (fake / Razorpay), settlement, webhooks, refunds
    notification, audit       Kafka consumers: emails (Mailpit/SES), audit log
prisma/              schema.prisma, migrations (incl. hand-written integrity triggers), seed.ts
test/integration/    component tests on real containers
test/e2e/            whole-app tests on real containers (auth, catalog, booking, payments, contracts, review fixes)
docker-compose.yml   local Postgres, MongoDB, Redis, Redpanda, Mailpit (+ mongo-express, RedisInsight, Redpanda Console with --profile tools)
```

## Checks

```bash
pnpm lint && pnpm typecheck && pnpm test:cov && pnpm build && pnpm db:drift
```

Design, data model, booking rules and the full API list: [`../docs/IMPLEMENTATION_PLAN.md`](../docs/IMPLEMENTATION_PLAN.md).
