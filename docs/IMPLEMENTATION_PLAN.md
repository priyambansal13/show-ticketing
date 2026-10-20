# Ticketing System (BookMyShow-style) — Implementation Plan

> Source HLD: [`docs/hld/ticketing-system-hld.pdf`](hld/ticketing-system-hld.pdf) (text extract: `hld/ticketing-system-hld.txt`)
> Stack: **Next.js 16.4** frontend · **NestJS 12** backend · Node 24 · PostgreSQL 17 · MongoDB 8 · Redis 8 · Kafka (Redpanda) — two separate repos
> Users: **Customer** (browse & book) and **Manager** (creates venues, events, shows) — two separate logins.

---

## 0. Decisions (defaults — change here if needed)

| # | Decision | Default |
|---|---|---|
| D1 | Payment provider | **Razorpay** (test mode), behind a `PaymentProvider` interface so Stripe can be swapped in |
| D2 | Manager onboarding | Self-signup → `PENDING_VERIFICATION` → **admin approves** (seeded admin; auto-approve in dev via `MANAGER_AUTO_APPROVE=true`) |
| D3 | Architecture | **Modular monolith first** (one NestJS app, one module per HLD service), split into microservices in Phase 8 |
| D4 | Search | MongoDB text index first, **Elasticsearch in Phase 8** |
| D5 | Local message broker | **Redpanda** (Kafka API-compatible, single container) |
| D6 | ORM / ODM | **Prisma** (Postgres) + **Mongoose** (MongoDB) |
| D7 | Job scheduling | **BullMQ** (Redis) for hold-expiry delayed jobs and retries |
| D8 | Repositories | **Two separate git repos**: `ticketing-api` (owns local infra) and `ticketing-web`; shared docs/skills in the parent workspace folder |
| D9 | Runtime & tooling | **Node 24**, **pnpm 12** (install scripts allow-listed), NestJS 12 (ESM) with **Vitest** + **oxlint**, Prisma **7.10** (stable; npm `latest` tag pointed at an 8.0 RC), Next.js 16.4 |
| D10 | Web ↔ API contract | API publishes **OpenAPI** generated from its zod DTOs; web generates types with `openapi-typescript` (`pnpm gen:api`) — replaces the old shared-package idea |

---

## 1. HLD → Implementation Mapping

| HLD area | HLD says | Implementation |
|---|---|---|
| Clients | Web & mobile | Next.js 16.4, responsive / mobile-first |
| API Gateway | Single entry, auth, routing, rate limiting | NGINX in front + NestJS global JWT guard + Redis-backed throttling |
| Auth Service | OAuth 2.0 + JWT | `auth` module: JWT access + rotating refresh tokens; Google OAuth later |
| Event Management | Events, venues, seat layouts | `events` module (MongoDB) |
| Seat Inventory | Available / locked / booked | `inventory` module (Postgres `show_seats` + Redis holds + WebSocket) |
| Booking Service | Lock seats, confirm on payment | `booking` module (state machine) |
| Payment Service | Gateway, retries, refunds, idempotency | `payment` module (Razorpay adapter, webhooks) |
| Notification Service | Email / SMS | `notification` module (Kafka consumer → Mailpit/SES, Twilio) |
| Transactional DB | PostgreSQL — bookings, payments, users | PostgreSQL 16 + Prisma |
| Event data | MongoDB / Elasticsearch | MongoDB 7 + Mongoose; Elasticsearch Phase 8 |
| Cache | Redis — seat availability, sessions, hot data | Redis 7 (ioredis), Lua scripts |
| Queue | Kafka — emails, payment retries, audit | Kafka (Redpanda) + transactional outbox; BullMQ for delayed jobs |
| Concurrency | Optimistic / pessimistic locking | Redis `SET NX` + Postgres conditional `UPDATE … WHERE status='AVAILABLE'` + `version` |
| Seat hold | Redis TTL, 5 min | `hold:{showId}:{seatId}` PX 300000 + expiry job + sweeper cron |
| CQRS | Split reads / writes | Reads from Redis `avail:*` hash + cached Mongo catalog; writes via Postgres txn |
| Idempotency | Payment idempotency keys | `Idempotency-Key` header persisted with unique constraint; webhook dedupe table |
| Infra | Kubernetes, Prometheus/Grafana, ELK | docker-compose locally; K8s + observability in Phase 8 |

---

## 2. Repository Layout (two repos)

```
ticketing-system/                     # workspace folder (not a repo): docs, CLAUDE.md, .claude/
├─ ticketing-api/                     # git repo — NestJS 12 (ESM), Node 24, pnpm 12
│  ├─ docker-compose.yml              # local infra: postgres, mongo, redis, redpanda, mailpit
│  ├─ prisma/
│  │  ├─ schema.prisma                # PostgreSQL model (§4.1)
│  │  ├─ migrations/                  # incl. hand-written CHECK constraints & partial indexes
│  │  └─ seed.ts                      # idempotent dev seed
│  ├─ prisma.config.ts                # Prisma 7 config (datasource URL, seed command)
│  ├─ src/
│  │  ├─ config/env.ts                # zod-validated environment
│  │  ├─ common/                      # money helpers; later guards, filters, interceptors
│  │  ├─ generated/prisma/            # generated client (git-ignored)
│  │  ├─ infra/                       # prisma, mongo (+ security defaults), redis (+ key registry)
│  │  └─ modules/
│  │     ├─ health/                   # /health/live, /health/ready
│  │     ├─ events/schemas/           # venues, seat_layouts, events, shows (Mongo)
│  │     └─ auth, users, inventory, booking, payment, notification, audit, reports   (upcoming)
│  └─ test/integration/               # Testcontainers suites (*.int-spec.ts)
└─ ticketing-web/                     # git repo — Next.js 16.4, React 19.3, Tailwind 4, Node 24
   └─ src/
      ├─ app/                         # (customer), manager/, admin/ route groups (§7)
      └─ lib/api/                     # generated OpenAPI types + typed fetchers + query hooks
```

## 3. Authentication — Two Logins

- **One `users` table**, `role` ∈ `CUSTOMER | MANAGER | ADMIN`; `unique(email, role)` (same person may hold both accounts).
- **Separate entry points**
  - Customer: `/login`, `/register` → `POST /api/v1/auth/customer/{login,register}`
  - Manager: `/manager/login`, `/manager/register` → `POST /api/v1/auth/manager/{login,register}`; new managers start `PENDING_VERIFICATION` and cannot create resources until `ACTIVE`.
- **Tokens**
  - Access JWT, 15 min, payload `{ sub, role, status }`, sent as `Authorization: Bearer`.
  - Refresh token, 7 days, httpOnly + Secure + SameSite=Lax cookie, rotated on each refresh, only **hash** stored in Postgres; reuse of a revoked token revokes the whole family.
  - Separate cookie per portal (`bms_c_rt`, `bms_m_rt`) so both can be logged in simultaneously.
- **Backend**: global `JwtAuthGuard` (opt-out via `@Public()`), `RolesGuard` + `@Roles()`, `ManagerOwnershipGuard` (manager touches only own venues/events/shows).
- **Frontend**: `middleware.ts` — `/manager/**` requires MANAGER, `/checkout/**` & `/bookings/**` require CUSTOMER.
- Passwords: argon2id. Login rate limit: 5/min per IP+email.

---

## 4. Data Model

### 4.1 PostgreSQL (source of truth for money & seats)

Canonical definition: `ticketing-api/prisma/schema.prisma` + `prisma/migrations/*_init/migration.sql`. Summary:

```sql
users            (id uuid v7, email (lower-case, CHECK), phone, password_hash, name,
                  role CUSTOMER|MANAGER|ADMIN, status ACTIVE|PENDING_VERIFICATION|SUSPENDED,
                  unique(email, role))
refresh_tokens   (id, user_id, family_id, token_hash char(64) unique, expires_at, revoked_at,
                  replaced_by_id, user_agent, ip)
manager_profiles (user_id pk, org_name, contact_phone, tax_id, verified_at, verified_by_id)

show_seats       (id, show_id char(24) hex, event_id char(24) hex, seat_id, section, row_label,
                  seat_number, price_tier, price numeric(10,2) > 0, currency char(3),
                  status AVAILABLE|HELD|BOOKED|BLOCKED, version, booking_id, hold_expires_at,
                  unique(show_id, seat_id), index(show_id, status), index(booking_id))
bookings         (id, booking_ref unique, user_id, show_id, event_id,
                  status PENDING|CONFIRMED|EXPIRED|CANCELLED|FAILED, total_amount > 0, currency (no default),
                  hold_expires_at, idempotency_key, confirmed_at, cancelled_at,
                  unique(user_id, idempotency_key), index(user_id, created_at desc), index(show_id, status),
                  partial index(hold_expires_at) WHERE status = 'PENDING')      -- expiry sweeper
booking_items    (id, booking_id, show_seat_id, price > 0, unique(booking_id, show_seat_id))
payments         (id, booking_id, provider, provider_order_id unique, provider_payment_id unique,
                  amount, currency, status CREATED|AUTHORIZED|CAPTURED|CAPTURED_DUPLICATE|FAILED|REFUNDED,
                  idempotency_key unique ("{bookingId}:{attempt}"), attempts, raw_response,
                  partial unique(booking_id) WHERE status = 'CAPTURED')
refunds          (id, payment_id, amount > 0, reason, status PENDING|PROCESSED|FAILED,
                  provider_refund_id unique, idempotency_key unique)
processed_webhooks (provider, provider_event_id) pk
idempotency_keys (user_id, route, key) pk, request_hash, response_status, response_body, expires_at
outbox           (id bigserial, aggregate, aggregate_id, topic, payload, headers,
                  status PENDING|SENT|FAILED, attempts, last_error, sent_at,
                  partial index(id) WHERE status = 'PENDING')                    -- relay, FOR UPDATE SKIP LOCKED
audit_logs       (id bigserial, actor_id, actor_role, action, entity, entity_id, payload, ip, request_id)
```

Every table has `created_at` / `updated_at` (`DEFAULT now()`, so raw-SQL writes need not set them). Ids are UUID v7 generated by Prisma — raw-SQL inserts must supply them.

**Enforced by the database (triggers, `migration.sql`), proven by `test/integration/postgres-invariants.int-spec.ts`:**

| Rule | Mechanism |
|---|---|
| Seat transitions only `AVAILABLE→HELD→BOOKED`, `HELD→AVAILABLE`, `BOOKED→AVAILABLE`, `AVAILABLE↔BLOCKED`; new seats AVAILABLE/BLOCKED | `show_seats_transition` (BEFORE, immediate) |
| Booking transitions only `PENDING→CONFIRMED/EXPIRED/FAILED`, `EXPIRED→CONFIRMED` (late payment), `CONFIRMED→CANCELLED`; new bookings PENDING | `bookings_transition` (BEFORE, immediate) |
| Seat status ↔ ownership columns agree | `show_seats_status_owner_chk` (CHECK) |
| Booking has ≥ 1 item; total = sum(items); items from the booking's show and currency; HELD seats ⇒ booking PENDING with the **same** hold expiry; BOOKED seats ⇒ booking CONFIRMED **and** a CAPTURED payment; CONFIRMED booking ⇒ all items BOOKED by it | `*_consistency` constraint triggers, `DEFERRABLE INITIALLY DEFERRED` (checked at COMMIT) |
| Payment amount and currency = booking total and currency | `payments_match_booking` |
| At most one CAPTURED payment per booking (a second capture is stored as `CAPTURED_DUPLICATE` and refunded) | partial unique index |
| Refunds only against captured money; sum of non-failed refunds ≤ payment amount, serialized per payment | `refunds_bounds` (locks the payment row) |
| Mongo ids are 24 lower-case hex chars; currencies `^[A-Z]{3}$`; prices > 0 | CHECK constraints |

### 4.2 MongoDB (catalog — flexible, read-heavy)

```js
venues       { _id, managerId, name, city, address, geo: { type: "Point", coordinates: [lng, lat] },
               halls: [{ hallId, name, layoutId }], status: "ACTIVE|INACTIVE", createdAt }

seat_layouts { _id, venueId, hallId, version,
               sections: [{ code: "GOLD", name, priceTier,
                 rows: [{ label: "A", seats: [{ id: "A1", number: 1, x, y,
                          type: "REGULAR|RECLINER|WHEELCHAIR|GAP" }] }] }],
               totalSeats, createdAt }

events       { _id, managerId, title, slug, description,
               category: "MOVIE|CONCERT|SPORTS|PLAY|COMEDY",
               language, genres: [], durationMins, posterUrl, bannerUrl, cast: [], ageRating,
               status: "DRAFT|PUBLISHED|CANCELLED", createdAt }        // text index: title, genres

shows        { _id, eventId, managerId, venueId, hallId, layoutId, layoutVersion,
               city, startsAt, endsAt, salesOpenAt,
               pricing: { GOLD: 45000, SILVER: 25000 },   // integer minor units (paise), > 0
               currency: "INR",
               status: "SCHEDULED|ON_SALE|CANCELLED|COMPLETED" }      // index: city+startsAt, eventId
```

**Bridge**: publishing a show **materializes** one `show_seats` row per layout seat in Postgres (price from `shows.pricing`). Layout (Mongo) = rendering; `show_seats` (PG) = selling. Layout is immutable once a show is on sale (new edits create a new `version`).

### 4.3 Redis

| Key | Type / TTL | Purpose |
|---|---|---|
| `hold:{showId}:{seatId}` | string → bookingId, PX 300000 | 5-min seat hold (set atomically for all seats via Lua) |
| `avail:{showId}` | hash seatId → `A`/`H`/`B`/`X` | Fast seat-map reads (CQRS read side) |
| `cache:event:{id}`, `cache:shows:{city}:{date}` | 60–300 s | Catalog cache |
| `rl:*` | short | Rate limiting |
| `bull:*` | — | BullMQ queues (`hold-expiry`, `payment-retry`) |
| socket.io adapter | pub/sub | Fan-out of live seat updates across API instances |

### 4.4 Kafka Topics

`booking.held`, `booking.confirmed`, `booking.expired`, `booking.cancelled`, `payment.captured`, `payment.failed`, `refund.processed`, `show.cancelled`, `audit.events`. All produced via the **outbox relay** (never directly inside a DB transaction).

---

## 5. Booking Flow & Double-Booking Prevention

```
Customer                 API (booking/inventory)            Redis            Postgres          Kafka
 | POST /bookings/hold {showId, seatIds} + Idempotency-Key
 |------------------------>| Lua: SET NX PX all hold keys ---->| all-or-nothing
 |                         | BEGIN
 |                         |  INSERT bookings(PENDING, hold_expires_at = T, total = Σ seat prices, currency)
 |                         |  INSERT booking_items SELECT id, price FROM show_seats WHERE show_id=$s AND seat_id=ANY($ids)
 |                         |  UPDATE show_seats SET status='HELD', booking_id=$b, hold_expires_at=T, version=version+1
 |                         |   WHERE show_id=$s AND seat_id=ANY($ids) AND status='AVAILABLE'
 |                         |  rowcount ≠ n → ROLLBACK, release Redis keys → 409 SEATS_UNAVAILABLE
 |                         |  INSERT outbox(booking.held)
 |                         | COMMIT (deferred consistency checks run here)
 |                         |  → HSET avail → WS emit seats:update; enqueue hold-expiry job (delay until T)
 |<-- 201 {bookingId, expiresAt: T, amount}
 | POST /payments/initiate {bookingId} → payments row (key "{bookingId}:{attempt}", amount = booking total)
 |                                       → provider order (provider idempotency key = bookingId)
 | … customer pays in Razorpay Checkout …
 |      Razorpay ──► POST /payments/webhook/razorpay (verify signature, dedupe event id, verify amount)
 |                         | BEGIN: payment CAPTURED; booking CONFIRMED;
 |                         |  UPDATE show_seats SET status='BOOKED', hold_expires_at=NULL WHERE booking_id=$b AND status='HELD'
 |                         |  outbox(booking.confirmed) COMMIT ──────────────────────────────────►| notification, audit
```

The booking row is inserted **before** the seat UPDATE because `show_seats.booking_id` references it.

**Invariants (must always hold — see `booking-integrity` skill; DB-enforced ones listed in §4.1):**
1. Postgres conditional update is the **final authority**; Redis is only the fast first gate.
2. Seat state transitions: `AVAILABLE → HELD → BOOKED`, `HELD → AVAILABLE` (expiry/release/fail), `BOOKED → AVAILABLE` (cancel+refund), `AVAILABLE ↔ BLOCKED` (manager). Nothing else.
3. Booking transitions: `PENDING → CONFIRMED | EXPIRED | FAILED`, `EXPIRED → CONFIRMED` (late payment only), `CONFIRMED → CANCELLED`.
4. Every state change + its outbox row are in **one transaction**.
5. **One expiry clock**: `bookings.hold_expires_at` (T). Seats copy T. The sweeper (cron every 60 s, plus a BullMQ delayed job per booking) selects `bookings WHERE status='PENDING' AND hold_expires_at < now()` and, per booking in one transaction, sets it EXPIRED and its HELD seats AVAILABLE. Nothing expires seats independently.
6. **Late payment** (webhook for an EXPIRED booking): in one transaction re-hold exactly the booking's item seats (`AVAILABLE → HELD`, all or nothing), capture, `EXPIRED → CONFIRMED`, seats `BOOKED`. If any seat is taken → record the payment CAPTURED, keep the booking EXPIRED, create a full refund (`refund:{paymentId}:full`).
7. **Double payment** (booking already has a CAPTURED payment): store the new payment as `CAPTURED_DUPLICATE` and refund it in full in the same transaction; acknowledge the webhook (never let it retry forever).
8. **Refunds**: deterministic idempotency keys (`refund:{paymentId}:full` / `refund:{paymentId}:{reason}`); the DB rejects refunding more than was captured.
9. Payments: one row per attempt (`{bookingId}:{attempt}`), amount/currency copied from the booking. Free seats (price 0) are out of scope.
10. All mutating customer endpoints accept `Idempotency-Key`; webhooks deduped by provider event id.
11. Webhook is the source of truth for payment; client `/payments/verify` only speeds up UX.

---

## 6. API Surface (`/api/v1`)

As implemented in `ticketing-api` (OpenAPI with request **and** response schemas: `/api/docs`, JSON at `/api/docs-json`; non-production only). Response shapes are enforced by `test/e2e/contract.e2e-spec.ts`.

**Auth** — `:portal` ∈ `customer | manager | admin`; each portal has its own httpOnly refresh cookie
`POST /auth/customer/register` · `POST /auth/manager/register` (→ PENDING_VERIFICATION) · `POST /auth/:portal/login` · `POST /auth/:portal/refresh` · `POST /auth/:portal/logout` · `GET /auth/me`

**Public catalog**
`GET /cities` · `GET /events?city=&category=&date=&q=&page=&limit=` · `GET /events/:idOrSlug` · `GET /events/:id/shows?city=&date=` · `GET /shows/:id` · `GET /shows/:id/seats` (layout + live status: AVAILABLE / UNAVAILABLE)

**Customer** (role CUSTOMER; mutating routes need `Idempotency-Key`)
`POST /bookings/hold` · `DELETE /bookings/:id/hold` · `GET /bookings?status=` · `GET /bookings/:id` · `POST /bookings/:id/cancel` · `GET /bookings/:id/ticket` (signed QR)
`POST /payments/initiate` · `POST /payments/verify` · `POST /payments/fake/complete` (dev only, fake provider, own orders)

**Manager** (role MANAGER + status ACTIVE; every resource scoped to its owner — others get 404)
Venues: `POST|GET /manager/venues` · `GET|PATCH /manager/venues/:id` · `POST /manager/venues/:id/halls` · `PUT|GET /manager/venues/:id/halls/:hallId/layout` (PUT = new immutable version)
Events: `POST|GET /manager/events` · `GET|PATCH /manager/events/:id` · `POST /manager/events/:id/publish`
Shows: `POST|GET /manager/shows` · `GET|PATCH /manager/shows/:id` · `POST /manager/shows/:id/publish` · `POST /manager/shows/:id/cancel` (**202**, refunds run in the background, idempotent) · `POST /manager/shows/:id/seats/block|unblock`
Operations: `GET /manager/shows/:id/bookings?status=` (masked customer email) · `POST /manager/tickets/verify` (checks in once) · `GET /manager/reports/sales?from=&to=`

**Admin** (role ADMIN)
`GET /admin/managers?status=` · `POST /admin/managers/:id/approve` · `POST /admin/managers/:id/suspend` (ends sessions and current access tokens immediately)

**System**
`POST /payments/webhook/:provider` (signed, deduped) · `GET /health/live` · `GET /health/ready` (status only) · `GET /metrics` (Prometheus; `METRICS_TOKEN` bearer, required in production)
WebSocket namespace `/seats`: emit `show:join` / `show:leave` with a showId (max 3 rooms, 20 sockets per IP per instance); receive `seats:update { showId, seatIds, status }`.

**Error envelope**: `{ "error": { "code": "SEATS_UNAVAILABLE", "message": "...", "details": {}, "requestId": "..." } }`
**Pagination**: `{ "data": [...], "meta": { "page", "limit", "total" } }` · **Money**: exact decimal strings (`"450.00"`), request prices in integer minor units (paise)

---

## 7. Frontend (Next.js App Router)

```
ticketing-web/src/app/
├─ (customer)/
│  ├─ page.tsx                        # home: city picker, trending, categories
│  ├─ events/page.tsx                 # search + filters
│  ├─ events/[id]/page.tsx            # detail + showtimes (ISR)
│  ├─ shows/[id]/seats/page.tsx       # live seat map (SVG + socket.io)
│  ├─ checkout/[bookingId]/page.tsx   # countdown + Razorpay
│  ├─ bookings/page.tsx · bookings/[id]/page.tsx
│  └─ login/ · register/
├─ manager/
│  ├─ login/ · register/ · pending/
│  └─ (portal)/
│     ├─ dashboard/page.tsx           # sales, occupancy, upcoming
│     ├─ venues/… · venues/[id]/halls/[hallId]/layout/   # seat layout builder
│     ├─ events/… · shows/… · shows/[id]/bookings/
├─ admin/(portal)/managers/
└─ proxy.ts                           # Next 16 name for middleware
```

Libraries: Tailwind CSS + shadcn/ui · TanStack Query · react-hook-form + zod (API types generated from OpenAPI) · socket.io-client · Razorpay Checkout · date-fns.
Catalog pages: Server Components + ISR. Seat map / checkout / dashboards: Client Components.

---

## 8. Phased Delivery & Progress Tracker

Tick items as they are completed. Each phase ends with its **exit criteria** verified.

### Phase 0 — Foundation
- [x] Two repos (`ticketing-api`, `ticketing-web`), Node 24 pinned (`.nvmrc`, `engines`, `engine-strict`), pnpm 12 with build allow-list
- [x] `ticketing-api/docker-compose.yml`: postgres 17, mongo 8 (replica set), redis 8, redpanda, mailpit — all with healthchecks
- [x] NestJS app: zod-validated env, pino logger with request ids + redaction, `/health/live` + `/health/ready` (Terminus)
- [x] **Database layer**: Prisma schema + `init` migration for all PostgreSQL tables (§4.1) with hand-written CHECK constraints and partial indexes; Mongoose schemas + indexes for venues, seat_layouts, events, shows (§4.2); Redis client + key registry (§4.3)
- [x] Idempotent dev seed: admin / manager / customer + venue → layout → event → on-sale show with 100 `show_seats`
- [x] Review fixes: DB-enforced seat/booking/payment/refund consistency (triggers), bounded pg pool + statement timeout, status-only health output with 2 s cache, request-id validation (UUID v7), wider log redaction, fail-closed seed, localhost-only dev ports, coverage thresholds
- [x] Tests: 89 unit (98% lines / 89% branches) + 45 integration on real containers (DB invariants & lifecycle incl. late payment, 200-way seat race → 1 winner, concurrent refunds, Mongo indexes/injection/update guards, app readiness)
- [x] NestJS: global exception filter + zod validation pipe + OpenAPI document (done in Phase 1)
- [x] KafkaJS producer + outbox relay, BullMQ providers, Kafka in `/health/ready` (done in Phases 4–6)
- [x] Next.js app: shadcn-style UI primitives on Radix (`src/components/ui`), typed API client from OpenAPI (`pnpm gen:api` → openapi-fetch), TanStack Query provider
- [ ] CI pipelines for both repos (lint, typecheck, test, test:int, build, audit, db:drift)
- **Exit**: `pnpm infra:up && pnpm dev` runs web + api; `/health` green for all deps.

> **Status (2026-10-12):** Phases 1–7 are complete on the **API** and the **web app** (`ticketing-web`: customer, manager and admin portals; 63 unit + 30 Playwright tests incl. axe; code, security and booking-integrity reviews PASS). API: 268 tests (unit + integration + e2e on real containers), coverage thresholds met; findings of the booking-integrity, security and code reviews fixed with regression tests (`test/e2e/review-fixes.e2e-spec.ts`). Remaining unchecked items are Phase 8 work or listed follow-ups (§11).

### Phase 1 — Auth & Two Logins
- [x] Prisma: `users`, `refresh_tokens`, `manager_profiles`
- [x] Customer + manager register/login, refresh rotation, logout, `/auth/me`
- [x] Guards: `JwtAuthGuard`, `RolesGuard`, `@Public()`, `@Roles()`, `@CurrentUser()`
- [x] Admin approval endpoints + seed admin
- [x] Web: customer, manager and admin login/register pages, `src/proxy.ts` (Next 16's renamed middleware), per-portal in-memory sessions with cross-tab refresh serialization
- **Exit**: both roles log in independently; cross-role access returns 403; e2e tests pass.

### Phase 2 — Manager Catalog
- [x] Mongo schemas: venues, seat_layouts, events, shows
- [x] Manager CRUD for venues/halls/layouts/events/shows with ownership guard
- [x] Seat layout builder UI (sections × rows × seats, seat types, hall-wide unique labels, versioned save)
- [x] Show publish → materialize `show_seats` exactly once (guarded by show status SCHEDULED→ON_SALE; re-publish is a no-op/error, never a silent partial re-materialization); prices from `pricing[tier]`, currency from the show
- [x] Show/layout edits go through `document.save()` (query updates of times, pricing, layout are blocked by schema guards)
- **Exit**: manager creates venue → layout → event → show → publish; seats exist in PG.

### Phase 3 — Customer Browse
- [x] Public catalog endpoints with filters + text search + pagination
- [x] Redis catalog caching + invalidation on manager updates
- [x] Home, search, event detail, showtimes pages (Server Components + `use cache`/`cacheLife` — the Cache Components form of ISR)
- **Exit**: customer finds an event by city/date/category and sees showtimes.

### Phase 4 — Seat Inventory & Holds
- [x] `GET /shows/:id/seats` (layout + `avail:*` hash, PG fallback + rehydrate)
- [x] Lua multi-seat hold script, conditional PG update, booking PENDING
- [x] Idempotency interceptor
- [x] BullMQ hold-expiry + sweeper cron; manual release
- [x] Socket.IO gateway (`/seats`, Redis adapter) — **API side**
- [x] Seat map UI with live updates + countdown (web) — ARIA grid, keyboard, socket updates batched per frame, refetch on reconnect
- **Exit**: concurrency test — 500 parallel holds for one seat → exactly 1 success, 499 × 409; expired holds free seats ≤ 60 s after TTL.
  - ✅ Verified: **500** parallel HTTP holds → 1 × 201, 499 × 409 (e2e); 200-way race at the DB level (integration). Expiry: per-booking delayed job at TTL + 1 s, sweeper every 60 s.

### Phase 5 — Payments
- [x] `PaymentProvider` interface + Razorpay adapter
- [x] Initiate, client verify, signed webhook, dedupe, confirm transaction
- [x] Failure path → release seats; late payment → re-hold or auto-refund
- [x] Retry queue for provider calls
- **Exit**: end-to-end paid booking in test mode; failed/expired payments never leave seats HELD or BOOKED.

### Phase 6 — Async: Notifications & Audit
- [x] Outbox relay (poll + `FOR UPDATE SKIP LOCKED`) → Kafka
- [x] Notification consumer: confirmation email with inline ticket QR (no PDF yet), cancellation and refund emails via Mailpit/SES SMTP; SMS stub (logs)
- [x] Audit consumer → `audit_logs`
- **Exit**: confirmation email appears in Mailpit; every booking/payment change has an audit row.

### Phase 7 — Manager Ops & Customer Self-Service
- [x] Sales/occupancy report API, bookings per show (masked customer email), door ticket verification
- [x] CSV export; dashboard UI (web)
- [x] Seat block/unblock
- [x] Show cancellation → bulk refunds + notifications
- [x] Customer cancellation with policy (e.g. ≥ 4 h before show, fee %)
- **Exit**: manager sees revenue; cancelling a show refunds all confirmed bookings.

### Phase 8 — Scale & Production
- [ ] Elasticsearch search index (fed from Kafka)
- [ ] k6 load tests: browse at scale; 2000 holds/s on one hot show
- [ ] PgBouncer, read replicas for reports, virtual waiting room for flash sales
- [ ] Prometheus + Grafana dashboards; ELK log aggregation
- [ ] Split modules into services behind NGINX; Dockerfiles, K8s manifests/Helm, HPA
- **Exit**: p95 hold latency < 200 ms at target load; zero double bookings under stress.

---

## 9. Testing Strategy

| Level | Tooling | Focus |
|---|---|---|
| Unit | Vitest | State machines, pricing, guards, Lua script wrapper |
| Integration | Vitest + Testcontainers (PG, Mongo, Redis) | Hold/confirm/expire, double-booking race, outbox |
| Contract | OpenAPI from API zod DTOs → generated web types | Web ↔ API shape parity (web CI fails on type diff) |
| E2E | Playwright | Customer booking journey; manager venue→show flow |
| Load | k6 | Browse throughput; hot-seat contention |

---

## 10. Non-Functional Checklist

- **Security**: argon2id, helmet, CORS allow-list, CSRF protection on cookie refresh route, webhook signature verification, input validation everywhere, no PII in logs.
- **Observability**: request id propagation, structured logs, `/metrics` (prom-client), booking funnel metrics.
- **Reliability**: graceful shutdown, health/readiness probes, retries with backoff + DLQ topics.
- **Data**: money as `numeric(10,2)` / integer paise in provider calls; all timestamps UTC `timestamptz`.
- **PII minimisation** (before Phase 5 goes live): `payments.raw_response` and `audit_logs.payload` store an allow-listed subset only (no email/contact/VPA/card data); retention policy for `audit_logs`, `refresh_tokens` (ip, user_agent) and expired `idempotency_keys`; consider app-level encryption for `manager_profiles.tax_id`.
- **Pool sizing**: `DATABASE_POOL_MAX` × API instances must stay below Postgres `max_connections` (PgBouncer in Phase 8).

> Detailed, enforceable standards live in `.claude/skills/`: `definition-of-done`, `security-standards`, `observability`, `performance-and-a11y`, `booking-integrity`, `git-workflow`. Quality targets are summarized in `CLAUDE.md` → "Quality bar".

---

## 11. Known Follow-ups (API)

Accepted for now, tracked here so they are not forgotten:

- **Captured-amount mismatch** is not refunded automatically (the captured amount cannot be trusted): it is flagged — audit `payment.amount_mismatch`, metric `payment_anomalies_total` — for manual handling. Add alerting on the metric.
- **Permanently failed refunds** (`refund.failed` audit, `refund_failures_total`) and **FAILED outbox rows** (`outbox_events{status="FAILED"}`) need an ops runbook / replay tool.
- **Kafka consumer lag** metric not exported yet; KafkaJS 2.2.4 is unmaintained (Node 24 prints a harmless `TimeoutNegativeWarning`) — evaluate `@confluentinc/kafka-javascript`.
- **Outbox ordering**: a row that fails and backs off can be overtaken by later rows of the same aggregate (consumers are idempotent; email order may differ).
- **Refresh-token rate limit** is per IP (not per token family).
- Seat-availability cache TTL is deliberately *not* extended on writes (keeps the 60 s self-healing); rebuilds are single-flight per instance.
- `requestId` is not yet propagated into BullMQ job data / consumer logs.
- CSV export of bookings and sales.
- `payment_webhook_lag_seconds` metric not implemented yet.
- **Login lockout trade-off**: the per-account lock (10 failures / 15 min) bounds distributed guessing but lets someone who knows an email temporarily lock that account; revisit with CAPTCHA / device-based throttling.

