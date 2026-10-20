# CLAUDE.md — Ticketing System (BookMyShow-style)

Multi-user event ticketing platform. **Customers** browse and book seats; **Managers** create venues, seat layouts, events and shows. Built from the HLD in `docs/hld/ticketing-system-hld.pdf` (kept locally, not published — `docs/hld/` is git-ignored).

**Read `docs/IMPLEMENTATION_PLAN.md` before starting any feature** — it is the source of truth for data model, APIs, booking flow, and phase order. Update its progress checkboxes when a task is done.

## Layout & stack

Run Claude Code from **this folder** (`ticketing-system/`) so the shared skills, agents and this file load. The whole folder is **one git repository** (monorepo, GitHub `priyambansal13/show-ticketing`); the two apps keep their own `package.json`, lockfile and tooling.

```
ticketing-system/
├─ CLAUDE.md, docs/, .claude/      # shared plan, standards, skills, agents
├─ ticketing-api/                  # NestJS 12 API + local infra (docker-compose.yml)
└─ ticketing-web/                  # Next.js 16.4 web app
```

- Runtime: **Node 24** (`.nvmrc` + `engines` + `engine-strict` in both apps), **pnpm 12** (`packageManager` pinned).
- `ticketing-api` — NestJS 12 (ESM) modular monolith · Prisma 7.10 (driver adapter `@prisma/adapter-pg`, client generated to `src/generated/prisma`) → PostgreSQL 17 · Mongoose 9 → MongoDB 8 (single-node replica set) · ioredis 6 → Redis 8 · KafkaJS → Redpanda · nestjs-pino · Terminus · Vitest + Testcontainers · oxlint.
- `ticketing-web` — Next.js 16.4 (App Router, `cacheComponents`), React 19.3, Tailwind 4, TanStack Query, react-hook-form + zod, socket.io-client. **Read `ticketing-web/AGENTS.md`: Next 16 APIs differ from older versions — check `node_modules/next/dist/docs/` before writing Next code.**
- pnpm blocks dependency install scripts by default; allowed/denied builds are listed in each app's `pnpm-workspace.yaml` (`allowBuilds`). Add an entry deliberately when a new native dependency needs it.

## Commands

```bash
# ticketing-api
cd ticketing-api
pnpm install                 # also runs prisma generate
pnpm infra:up                # postgres, mongo, redis, redpanda, mailpit (waits for healthy)
pnpm db:migrate              # prisma migrate dev  (--create-only to hand-edit SQL)
pnpm db:seed                 # admin / manager / customer + sample show with 100 seats
pnpm db:drift                # fails if DB and schema.prisma differ
pnpm start:dev               # http://localhost:4000/api/v1  (health: /health/ready)
pnpm test                    # unit (Vitest, no I/O)
pnpm test:int                # integration — components on real containers (Testcontainers, Docker required)
pnpm test:e2e                # end-to-end — whole app over HTTP/WebSocket on Postgres/Mongo/Redis/Redpanda/Mailpit containers
pnpm test:cov                # all three suites + definition-of-done coverage thresholds
pnpm infra:tools             # + mongo-express (:8081, dev/dev) and RedisInsight (:5540)
pnpm db:studio               # Prisma Studio for Postgres (:5555)
pnpm lint && pnpm typecheck && pnpm build

# ticketing-web
cd ticketing-web
pnpm dev                     # http://localhost:3000 (customer) · /manager/login · /admin/login
pnpm gen:api                 # regenerate src/lib/api/schema.d.ts from the running API's OpenAPI
pnpm test                    # unit (Vitest)
pnpm test:e2e                # Playwright desktop + mobile + axe — needs the local API stack running
pnpm lint && pnpm typecheck && pnpm build
```

Mailpit UI: http://localhost:8025 · Swagger: http://localhost:4000/api/docs · Seed credentials: `ticketing-api/.env.example`.
Dev payments use `PAYMENT_PROVIDER=fake`: `POST /payments/fake/complete { orderId }` returns what the browser checkout would, then call `POST /payments/verify`.

## Where data lives

| Data | Store | Why |
|---|---|---|
| users, refresh tokens, show_seats, bookings, payments, refunds, outbox, audit_logs | **PostgreSQL** | transactions & consistency |
| venues, seat_layouts, events, shows | **MongoDB** | flexible catalog, read-heavy |
| seat holds, availability hash, cache, rate limits, queues | **Redis** | speed & TTL |
| domain events (booking/payment/notification/audit) | **Kafka** via outbox | async, decoupled |

Never put seat state or selling prices in MongoDB (show `pricing` is configuration, stored as integer paise). Never treat Redis as the source of truth for seat state.

## Non-negotiable rules

1. **Double booking must be impossible.** Seat state changes go through the Postgres conditional update (`WHERE status = 'AVAILABLE'` / `'HELD'` + rowcount check). Redis `SET NX` is only a fast first gate. Use the `booking-integrity` skill for any change touching `inventory`, `booking`, or `payment`.
2. **State change + outbox row in one DB transaction.** Never publish to Kafka directly from inside a request transaction.
3. **Idempotency**: mutating customer endpoints accept `Idempotency-Key`; payment webhooks are deduped by provider event id.
4. **Auth**: two portals, one `users` table with `role`. Every non-public route is protected by the global `JwtAuthGuard`; use `@Public()` to opt out, `@Roles('MANAGER')` for manager routes, and the ownership guard for any manager resource by id.
5. **Module boundaries**: a module may only call another module through its exported service — no reaching into another module's repositories/models. Cross-module side effects go through domain events. (Modules will be split into microservices in Phase 8.)
   - **Documented exception — payment settlement**: invariant 4 requires booking, seats and payment to change in one transaction, so `PaymentService` passes its transaction to `BookingService.lockForSettlement / confirmInTx / lateConfirmInTx`. Refund rows are owned by the `ledger` module (`RefundRequests`), used by both booking and payment.
6. **API contract across apps**: request/response schemas are zod DTOs in `ticketing-api` and are published as OpenAPI (`/api/docs-json`, Phase 1). `ticketing-web` generates its API types from it (`pnpm gen:api` → `src/lib/api/schema.d.ts`) — never hand-write API response types in the web app. A breaking contract change updates both apps in the same PR (API change + `pnpm gen:api` + web fixes).
7. Money: `numeric(10,2)` in PG, integer minor units (paise) when calling payment providers. Timestamps: UTC `timestamptz`.
8. Secrets only via env (`.env.example` documents every variable). No secrets in code or logs.

## Quality bar (enforced — see `definition-of-done`)

| Area | Target |
|---|---|
| TypeScript | `strict`, `noUncheckedIndexedAccess`; no `any`, no unexplained `@ts-ignore` / `eslint-disable` |
| Lint | zero errors and zero warnings (CI treats warnings as errors) |
| Coverage | api services ≥ 80% lines / 75% branches; `inventory`, `booking`, `payment` ≥ 95% / 90%; 100% of state transitions |
| Integrity | 0 double bookings in the 500-parallel-holds test and k6 hot-seat test |
| API latency (p95) | catalog ≤ 100 ms · seat map ≤ 80 ms · hold ≤ 200 ms @ 2,000 req/s |
| Web | LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1; Lighthouse perf ≥ 90 (catalog), a11y ≥ 95 |
| Accessibility | WCAG 2.2 AA; axe: zero serious/critical; seat status never color-only |
| Security | OWASP ASVS L2; `pnpm audit --prod` no high/critical; every `:id` route has an ownership test |
| Reviews | zero open critical/high findings from `code-reviewer`, `security-reviewer`, `booking-integrity-reviewer` before a task/phase is done |

"Done" means verified by running commands, with results reported. Never report done with a failing gate.

## Conventions

- API prefix `/api/v1`. Errors: `{ error: { code, message, details } }` with UPPER_SNAKE `code`. Lists: `{ data, meta: { page, limit, total } }`.
- Mongoose: every `@Prop` declares an explicit `type`; `applyMongooseSecurityDefaults()` runs before any connection; server-built operators use `mongoose.trusted()`.
- NestJS module layout: `module.ts`, `controller.ts`, `service.ts`, `dto/`, `entities|schemas/`, `*.spec.ts`. Thin controllers, logic in services.
- Next.js: Server Components by default; `"use client"` only for interactivity. Customer pages under `app/(customer)`, manager under `app/manager`, admin under `app/admin`. Data fetching via TanStack Query hooks in `src/lib/api/`.
- File names kebab-case; classes PascalCase; DB columns snake_case (Prisma `@map`).
- Tests are required for: booking/payment state transitions, guards, and any concurrency-sensitive code.
- Conventional commits (`feat(booking): …`, `fix(auth): …`), scoped to the app the change belongs to (`feat(web): …`, `fix(api/booking): …`).
- ESM in the API: relative imports end in `.js` (`import { X } from './x.js'`).

## Project skills & agents

Skills (`.claude/skills/`):
- Workflow: `implement-phase` (drive a phase to its exit criteria through the quality gate), `git-workflow`
- Building: `nest-module`, `api-endpoint`, `next-page`, `db-change`
- Standards: `definition-of-done` (mandatory final gate), `booking-integrity`, `security-standards`, `observability`, `performance-and-a11y`

Agents (`.claude/agents/`) — builders load their skills first and must pass `definition-of-done`:
- Builders: `backend-engineer`, `frontend-engineer`, `data-architect`, `test-engineer`
- Read-only reviewers (verdict + findings with `file:line`, scenario, fix, test):
  - `code-reviewer` — every diff
  - `security-reviewer` — auth, endpoints, payments, uploads
  - `booking-integrity-reviewer` — inventory, booking, payment, outbox

Standard loop per task: build → `definition-of-done` → reviewers → fix critical/high → re-review → tick the plan.
