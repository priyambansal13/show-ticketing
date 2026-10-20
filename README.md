# Ticketing System — BookMyShow-style platform

Customers browse events, pick seats on a live seat map, pay and get a QR ticket.
Managers create venues, seat layouts, events and shows, and see sales. Admins approve managers.

| Folder | What it is | Stack |
|---|---|---|
| `ticketing-api/` | Backend API (own git repo) | NestJS 12, PostgreSQL 17 (Prisma 7), MongoDB 8, Redis 8, Kafka (Redpanda), BullMQ |
| `ticketing-web/` | Web app (own git repo) — customer, manager and admin portals | Next.js 16.4, React 19, Tailwind 4, TanStack Query |
| `docs/` | HLD and implementation plan (`docs/IMPLEMENTATION_PLAN.md`) | |
| `CLAUDE.md`, `.claude/` | Project rules, skills and agents for Claude Code | |

---

## 1. Prerequisites (one-time)

| Tool | Version | Install (macOS) | Check |
|---|---|---|---|
| Node.js | **24** | `nvm install 24 && nvm use 24` | `node -v` → `v24.x` |
| pnpm | **12** | `npm i -g pnpm@12` | `pnpm -v` → `12.x` |
| Docker Desktop | recent | https://www.docker.com/products/docker-desktop — start it | `docker info` |
| jq (optional, for the curl walkthrough) | any | `brew install jq` | `jq --version` |

Both repos contain `.nvmrc`, so `nvm use` inside each folder selects Node 24. Installs fail on other Node versions (`engine-strict`).

---

## 2. First-time setup

```bash
cd ~/Documents/PriyamLearning/Projects/ticketing-system/ticketing-api

nvm use                     # Node 24
pnpm install                # also generates the Prisma client
cp .env.example .env        # local configuration (dev defaults work as-is)

pnpm infra:up               # start Postgres, MongoDB, Redis, Redpanda (Kafka), Mailpit — waits until healthy
pnpm db:deploy              # create the database tables (applies all migrations)
pnpm db:seed                # demo accounts + one venue/event/show with 100 seats
```

Web app:

```bash
cd ../ticketing-web
nvm use
pnpm install
cp .env.example .env.local              # dev defaults work as-is
pnpm exec playwright install chromium   # only needed for the browser tests (pnpm test:e2e)
```

---

## 3. Run everything (daily)

Open **three terminals** (a fourth for Prisma Studio if you want it):

```bash
# Terminal 1 — databases + browser tools for them
cd ~/Documents/PriyamLearning/Projects/ticketing-system/ticketing-api
pnpm infra:tools            # databases + mongo-express + RedisInsight + Redpanda Console (use `pnpm infra:up` for databases only)

# Terminal 2 — API (restarts on code changes)
cd ~/Documents/PriyamLearning/Projects/ticketing-system/ticketing-api
pnpm start:dev

# Terminal 3 — web app (restarts on code changes)
cd ~/Documents/PriyamLearning/Projects/ticketing-system/ticketing-web
pnpm dev

# Terminal 4 — Postgres browser (optional)
cd ~/Documents/PriyamLearning/Projects/ticketing-system/ticketing-api
pnpm db:studio
```

Then open **http://localhost:3000**.

### What each command starts

`pnpm infra:up` does **not** start everything — it starts only the databases and the email catcher. The browser tools, the API and Prisma Studio each have their own command.

| Command (in `ticketing-api/`) | Starts | Address | Opens in a browser? |
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
| `pnpm dev` (in `ticketing-web/`) | the web app | http://localhost:3000 | **Yes** |

The database ports are for the API and for desktop database clients — opening them in a browser shows nothing.

**How long they keep running**

| Command | Runs where | Stops when |
|---|---|---|
| `pnpm infra:up` / `pnpm infra:tools` | Docker containers in the background — the command returns once they are healthy | you run `pnpm infra:down` (or quit Docker Desktop). Data survives restarts. |
| `pnpm start:dev` / `pnpm db:studio` / `pnpm dev` | in your terminal | you press `Ctrl+C` or close that terminal |

So to have **every URL working**: `pnpm infra:tools` once, then keep `pnpm start:dev` and `pnpm db:studio` open in their own terminals.

**Connecting a desktop database client** (TablePlus, DBeaver, MongoDB Compass, …) to the running containers:

| Database | Connection |
|---|---|
| PostgreSQL | host `localhost`, port `5432`, database `ticketing`, user `ticketing`, password `ticketing` — `postgresql://ticketing:ticketing@localhost:5432/ticketing` |
| MongoDB | `mongodb://localhost:27017/ticketing?replicaSet=rs0&directConnection=true` (keep `directConnection=true`) |
| Redis | host `localhost`, port `6379`, no password |
| Kafka (Redpanda) | bootstrap server `localhost:19092` |

All ports are bound to `127.0.0.1`, so they are reachable only from this computer. These credentials are for local development only.

### URLs

Use `http://` (not `https://`). If `localhost` misbehaves in your browser, use `127.0.0.1` — see Troubleshooting.

| What | URL | Login |
|---|---|---|
| **API docs (Swagger) — try every endpoint** | http://localhost:4000/api/docs | see accounts below |
| API health | http://localhost:4000/api/v1/health/ready | — |
| API metrics (Prometheus) | http://localhost:4000/api/v1/metrics | — (token required in production) |
| PostgreSQL browser (Prisma Studio) | http://localhost:5555 | — |
| MongoDB browser (mongo-express) | http://localhost:8081 | `dev` / `dev` |
| Redis browser (RedisInsight) | http://localhost:5540 | — (connection `ticketing-local` is preset) |
| Kafka browser (Redpanda Console) | http://localhost:8080 | — |
| Emails sent by the app (Mailpit) | http://localhost:8025 | — |
| **Web app — customer site** | http://localhost:3000 | customer account below (or *Create an account*) |
| Web app — organizer (manager) portal | http://localhost:3000/manager/login | manager account below |
| Web app — admin portal (approve managers) | http://localhost:3000/admin/login | admin account below |

> `http://localhost:4000` alone returns 404 — every API route lives under `/api/v1`, docs under `/api/docs`.

### Seeing Kafka

Kafka runs as **Redpanda** (Kafka-compatible). Browse it in **Redpanda Console** — http://localhost:8080 (started by `pnpm infra:tools`):

- **Topics** — one per domain event: `booking.held`, `booking.confirmed`, `booking.expired`, `booking.cancelled`, `payment.captured`, `payment.failed`, `refund.requested`, `refund.processed`, `show.cancelled`, `audit.events`, each with a `<topic>.dlq` dead-letter topic for messages a consumer could not process.
- **Messages** — open a topic → *Messages* to see each event's JSON, key (the booking/payment id) and headers (`outboxId`, `requestId`).
- **Consumer groups** — `ticketing-notifications` (emails) and `ticketing-audit` (audit log), with their lag.

Make a booking (section 4) and watch `booking.held` → `payment.captured` → `booking.confirmed` appear.

From the terminal (`rpk` is Redpanda's CLI, inside the container):

```bash
cd ticketing-api
docker compose exec redpanda rpk topic list                              # all topics
docker compose exec redpanda rpk topic consume booking.confirmed -n 5    # last messages of a topic
docker compose exec redpanda rpk group list                              # consumer groups
docker compose exec redpanda rpk group describe ticketing-notifications  # lag per partition
```

Events reach Kafka through the **outbox** table in Postgres (`outbox` — view it in Prisma Studio): a row is written in the same transaction as the booking change, then the API relays it to Kafka (`status` PENDING → SENT; FAILED if a row could never be delivered).

### Demo accounts (created by `pnpm db:seed`)

| Portal | Email | Password |
|---|---|---|
| Admin | `admin@ticketing.local` | `ChangeMe!Admin123` |
| Manager | `manager@ticketing.local` | `ChangeMe!Manager123` |
| Customer | `customer@ticketing.local` | `ChangeMe!Customer123` |

**In Swagger:** run `POST /api/v1/auth/{portal}/login` (portal = `customer`, `manager` or `admin`) with the email/password → copy `accessToken` → click **Authorize** (top right) → paste it. Now protected endpoints work.

### Try it in the browser

1. **Book as a customer** — open http://localhost:3000 → pick an event → pick a showtime → click seats on the live seat map (arrow keys + Space work too) → *Proceed to pay* → sign in (or create an account) → *Pay* → *Pay (test)*. You land on the booking with its **QR ticket**; the confirmation email is in Mailpit (http://localhost:8025). *Cancel booking* refunds minus the 10% fee.
2. **Watch seats update live** — open the same show's seat map in two windows; holding a seat in one greys it out in the other within a second.
3. **Run an event as a manager** — http://localhost:3000/manager/login → *Venues* → new venue → add a hall → *Design layout* (sections × rows × seats; click a seat to make it recliner / wheelchair / gap) → *Events* → new event → *Publish* → *Shows* → new show (prices per tier) → *Publish*. It is now bookable on the customer site. *Dashboard* shows sales and occupancy (CSV export); *Ticket check-in* verifies a ticket code once.
4. **Approve a manager as admin** — register at http://localhost:3000/manager/register (lands on "awaiting approval"), then approve it at http://localhost:3000/admin/login.

Customer, manager and admin sessions are separate: you can be signed in to all three in one browser.

---

## 4. Try a full booking from the terminal

The API runs with a **fake payment provider** locally, so no Razorpay account is needed.

```bash
API=http://localhost:4000/api/v1

# 1. Sign in as the demo customer
TOKEN=$(curl -s -X POST $API/auth/customer/login -H 'Content-Type: application/json' \
  -d '{"email":"customer@ticketing.local","password":"ChangeMe!Customer123"}' | jq -r .accessToken)

# 2. Find an event, a show with free seats, and a free seat
EVENT=$(curl -s "$API/events?city=bengaluru" | jq -r '.data[0].id')
for S in $(curl -s "$API/events/$EVENT/shows" | jq -r '.[].id'); do
  if [ "$(curl -s "$API/shows/$S/seats" | jq '.availableSeats')" -gt 0 ]; then SHOW=$S; break; fi
done
SEAT=$(curl -s "$API/shows/$SHOW/seats" | jq -r '[.sections[].rows[].seats[] | select(.status=="AVAILABLE")][0].id')

# 3. Hold the seat (5-minute hold)
BOOKING=$(curl -s -X POST $API/bookings/hold -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" -d "{\"showId\":\"$SHOW\",\"seatIds\":[\"$SEAT\"]}" | jq -r .id)

# 4. Start the payment, "pay" with the fake provider, confirm
ORDER=$(curl -s -X POST $API/payments/initiate -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" -d "{\"bookingId\":\"$BOOKING\"}" | jq -r .orderId)
PAYMENT=$(curl -s -X POST $API/payments/fake/complete -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"orderId\":\"$ORDER\"}")
curl -s -X POST $API/payments/verify -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "$PAYMENT" \
  | jq '{outcome, status: .booking.status, ref: .booking.bookingRef, seats: [.booking.seats[].seatId]}'

# 5. Get the ticket (signed QR code)
curl -s $API/bookings/$BOOKING/ticket -H "Authorization: Bearer $TOKEN" | jq '{bookingRef, ticketCode}'
```

Expected: `"outcome": "confirmed"`, `"status": "CONFIRMED"`. Within a few seconds the confirmation email (with the QR code) appears in **Mailpit** (http://localhost:8025) — the demo customer's inbox.

---

## 5. Tests and quality checks

```bash
cd ticketing-api
pnpm lint          # oxlint + prettier check
pnpm typecheck
pnpm test          # unit tests (fast, no Docker)
pnpm test:int      # integration tests — real Postgres/Mongo/Redis containers (Docker required)
pnpm test:e2e      # end-to-end — whole app on real containers incl. Kafka and Mailpit (~1 min)
pnpm test:cov      # all three suites + coverage thresholds (fails below the bar)
pnpm build
pnpm db:drift      # fails if the database and prisma/schema.prisma differ
pnpm audit --prod  # dependency vulnerabilities
```

Test containers are separate throwaway containers — tests never touch your local data.

Web app:

```bash
cd ticketing-web
pnpm lint          # eslint (zero warnings) + prettier check
pnpm typecheck
pnpm test          # unit tests (Vitest — money math, seat map, layout generator, CSV, validation…)
pnpm test:e2e      # browser tests (Playwright, desktop + mobile): booking, live seats, manager flow, auth, axe accessibility
pnpm build
pnpm gen:api       # regenerate API types from http://localhost:4000/api/docs-json after an API contract change
pnpm audit --prod
```

`pnpm test:e2e` uses your **running** local stack (API on :4000 with seed data; it starts the web dev server if needed) and creates real test data in it (venues, events, bookings named `E2E …`). The API rate-limits sign-ups (3/min) and logins (5/min per email), so wait a minute between back-to-back runs.

---

## 6. Stop, restart, reset

| Goal | Command (in `ticketing-api/`) |
|---|---|
| Stop the API / Prisma Studio | `Ctrl+C` in their terminal |
| Stop all containers (data is kept) | `pnpm infra:down` |
| Start them again | `pnpm infra:up` (or `pnpm infra:tools` with the browser tools) |
| **Wipe all local data** and start fresh | `pnpm infra:reset && pnpm db:deploy && pnpm db:seed` |

---

## 7. Everyday commands (API)

| Command | What it does |
|---|---|
| `pnpm start:dev` | API on :4000 with auto-restart |
| `pnpm start:prod` | run the built API (`pnpm build` first) |
| `pnpm db:migrate --name <change>` | create + apply a new migration after editing `prisma/schema.prisma` |
| `pnpm db:deploy` | apply existing migrations (no prompts) |
| `pnpm db:seed` | (re)create demo data — safe to run repeatedly |
| `pnpm db:studio` | Prisma Studio on :5555 |
| `pnpm db:generate` | regenerate the Prisma client (done automatically by install/build/tests) |
| `pnpm infra:up` / `infra:tools` / `infra:down` / `infra:reset` | manage Docker services |
| `pnpm format` | auto-format code with Prettier |

---

## 8. Configuration

All settings are environment variables, documented in `ticketing-api/.env.example` and validated at startup (the API refuses to start with a clear message if something is wrong). The defaults are for local development. Notable ones:

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `4000` | API port |
| `PAYMENT_PROVIDER` | `fake` | `fake` (local) or `razorpay` (needs `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`) |
| `MANAGER_AUTO_APPROVE` | `false` | `true` = new managers are active without admin approval (dev only) |
| `SEAT_HOLD_TTL_SECONDS` | `300` | how long a seat hold lasts before payment |
| `CANCELLATION_CUTOFF_HOURS` / `CANCELLATION_FEE_PERCENT` | `4` / `10` | customer cancellation policy |
| `JWT_ACCESS_SECRET`, `TICKET_SIGNING_SECRET` | dev values | **must be replaced** outside local dev (`openssl rand -base64 48`) |

Production additionally requires `METRICS_TOKEN`, `SMTP_REQUIRE_TLS=true`, and forbids the fake payment provider.

Web app settings live in `ticketing-web/.env.local` (template: `.env.example`):

| Variable | Default | Meaning |
|---|---|---|
| `API_ORIGIN` | `http://localhost:4000` | where the API runs; the browser's `/api/v1/*` calls are proxied there (same origin, so the refresh cookie stays first-party) |
| `NEXT_PUBLIC_SOCKET_URL` | `http://localhost:4000` | live seat updates connect here directly (WebSockets are not proxied); the web app's origin must be listed in the API's `CORS_ORIGINS` |
| `NEXT_PUBLIC_IMAGE_HOSTS` | `images.unsplash.com` | https hosts allowed for event posters; others show a placeholder |

Behind the web app's proxy the API sees the web server as the client. In production put an edge proxy / load balancer in front of the web app that **overwrites** `X-Forwarded-For` with the real client IP (Next.js passes an incoming one through unchanged, so it must not be trusted when Next.js faces the internet directly), and set the API's `TRUST_PROXY_HOPS` to the number of proxies — then rate limits apply per real visitor.

---

## 9. Troubleshooting

| Problem | Fix |
|---|---|
| **Browser can't open `http://localhost:8081` / `5540` / `8025`** (works with curl) | An earlier API build sent an HSTS header that made the browser force HTTPS on `localhost`. Use `http://127.0.0.1:<port>`, or clear it — Chrome/Edge: `chrome://net-internals/#hsts` → *Delete domain security policies* → `localhost`; Safari: quit Safari, `rm ~/Library/Cookies/HSTS.plist`; Firefox: History → right-click a localhost entry → *Forget About This Site*. |
| `http://localhost:4000` shows 404 | Expected — use `/api/docs` or `/api/v1/...` |
| `port is already allocated` when starting Docker | Another program uses 5432/27017/6379/19092/8025/8081/5540/8080. Stop it, or change the left port in `docker-compose.yml`. |
| API exits with `Invalid environment configuration` | A variable in `.env` is missing/invalid — the message names it. Compare with `.env.example` (`cp .env.example .env` to reset). |
| `Can't reach database server` / health shows `down` | `pnpm infra:up` (Docker Desktop must be running), then `docker compose ps`. |
| `Unknown argument …` / Prisma type errors after pulling changes | `pnpm db:generate` (and `pnpm db:deploy` for new migrations). |
| `ERR_PNPM_IGNORED_BUILDS` during install | A new dependency wants to run an install script — allow or deny it under `allowBuilds` in `pnpm-workspace.yaml`. |
| `Unsupported engine` | Wrong Node version — `nvm use` (Node 24). |
| Login returns `429` | Rate limit / lockout after failed attempts — wait 1 minute (15 minutes after 10 failed logins). |
| Seat map shows no free seats for an old show | Local demo data out of sync after a database reset — run the full reset in section 6. |
| `TimeoutNegativeWarning` in the API log | Harmless warning from the Kafka client library on Node 24. |
| Web app says *Events are unavailable right now* | The API is not running or not reachable at `API_ORIGIN` — start `pnpm start:dev` in `ticketing-api`. Catalog pages retry automatically within seconds. |
| Seat map says *Live updates paused* | The browser cannot open the WebSocket to `NEXT_PUBLIC_SOCKET_URL` (API down, or the web origin is missing from the API's `CORS_ORIGINS`). Booking still works; the map refreshes on reconnect. |
| `pnpm test:e2e` fails with *Too many attempts* | API rate limits — wait one minute and rerun. |
| Web dev server shows old styles after editing `globals.css` | Stop and restart `pnpm dev`. |

---

## 10. Where to read more

- `docs/IMPLEMENTATION_PLAN.md` — architecture, data model, booking flow, full API list (§6), phase status, known follow-ups (§11)
- `CLAUDE.md` — project rules and conventions
- `ticketing-api/README.md` — API-specific notes
- `ticketing-web/README.md` — web app structure and conventions
- http://localhost:4000/api/docs — live API reference
