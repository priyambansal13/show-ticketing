# ticketing-web

Next.js 16.4 web app of the BookMyShow-style ticketing platform: **customer site**, **organizer (manager) portal** and **admin portal**.
It talks to the NestJS API in [`../ticketing-api`](../ticketing-api). Whole-stack guide (Docker services, API, seed data): [`../README.md`](../README.md).

## 1. Prerequisites

| Tool    | Version                                 | Check                                     |
| ------- | --------------------------------------- | ----------------------------------------- |
| Node.js | 24.x (`.nvmrc`)                         | `node -v`                                 |
| pnpm    | 12.x (`packageManager` in package.json) | `pnpm -v`                                 |
| API     | running on http://localhost:4000        | `curl localhost:4000/api/v1/health/ready` |

The API needs its Docker services (Postgres, Redis, Mongo, Redpanda) — from `../ticketing-api`: `pnpm infra:up`, then `pnpm start:dev`.

## 2. Setup (first time)

```bash
cd ticketing-web
nvm use                       # Node 24
pnpm install
cp .env.example .env.local    # defaults work for local development
pnpm exec playwright install chromium   # only needed for browser tests
```

## 3. Run

```bash
pnpm dev                      # dev server → http://localhost:3000 (hot reload)
```

Production mode locally:

```bash
pnpm build && pnpm start      # http://localhost:3000
```

| Portal    | URL                                 | Demo login (seeded by the API)                      |
| --------- | ----------------------------------- | --------------------------------------------------- |
| Customer  | http://localhost:3000               | `customer@ticketing.local` / `ChangeMe!Customer123` |
| Organizer | http://localhost:3000/manager/login | `manager@ticketing.local` / `ChangeMe!Manager123`   |
| Admin     | http://localhost:3000/admin/login   | `admin@ticketing.local` / `ChangeMe!Admin123`       |

## 4. All commands

| Command                            | What it does                                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------------------------------- |
| `pnpm dev`                         | Dev server on port 3000 (Turbopack, hot reload)                                                 |
| `pnpm build`                       | Production build (fails on type errors)                                                         |
| `pnpm start`                       | Serve the production build on port 3000                                                         |
| `pnpm lint`                        | ESLint (zero warnings allowed) + Prettier check                                                 |
| `pnpm format`                      | Auto-format all files with Prettier                                                             |
| `pnpm typecheck`                   | Generate route types (`next typegen`) and run `tsc --noEmit`                                    |
| `pnpm gen:api`                     | Regenerate API types from the running API's OpenAPI spec → `src/lib/api/schema.d.ts`            |
| `pnpm test`                        | Unit tests (Vitest)                                                                             |
| `pnpm test:watch`                  | Unit tests in watch mode                                                                        |
| `pnpm test:e2e`                    | Browser tests (Playwright, desktop + mobile, with axe accessibility checks) — needs API running |
| `pnpm test:e2e --ui`               | Browser tests in Playwright's interactive UI                                                    |
| `pnpm exec playwright show-report` | Open the last browser-test report                                                               |

Run everything CI would:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

**Run `pnpm gen:api` whenever the API's endpoints or DTOs change**, then fix any type errors it reveals.

## 5. Environment variables

Put them in `.env.local` (git-ignored). Only `NEXT_PUBLIC_*` values reach the browser, and they are baked in at **build** time — rebuild after changing them.

### App

| Variable                                | Required | Default                 | Purpose                                                                                                  |
| --------------------------------------- | -------- | ----------------------- | -------------------------------------------------------------------------------------------------------- |
| `API_ORIGIN`                            | yes      | `http://localhost:4000` | NestJS API. Server-only: catalog pages fetch from it and browser calls to `/api/v1/*` are proxied to it. |
| `NEXT_PUBLIC_SOCKET_URL`                | yes      | `http://localhost:4000` | Socket.IO server for the live seat map (WebSockets go straight to the API, not through the proxy).       |
| `NEXT_PUBLIC_IMAGE_HOSTS`               | no       | `images.unsplash.com`   | Comma-separated https hosts allowed for event posters. Other hosts show a placeholder.                   |
| `NEXT_PUBLIC_MAX_SEATS_PER_BOOKING`     | no       | `10`                    | Seat limit shown in the seat picker. Keep equal to the API's `MAX_SEATS_PER_BOOKING`.                    |
| `NEXT_PUBLIC_CANCELLATION_CUTOFF_HOURS` | no       | `4`                     | Cancellation cutoff shown to customers. Keep equal to the API's `CANCELLATION_CUTOFF_HOURS`.             |
| `NEXT_PUBLIC_CANCELLATION_FEE_PERCENT`  | no       | `10`                    | Cancellation fee shown to customers. Keep equal to the API's `CANCELLATION_FEE_PERCENT`.                 |

The API is the authority for seat limits, cancellation rules and the seat-hold time (`SEAT_HOLD_TTL_SECONDS`, 5 minutes by default); the web values only control what the UI says.

### Tooling (optional)

| Variable                                 | Default                               | Used by                                                     |
| ---------------------------------------- | ------------------------------------- | ----------------------------------------------------------- |
| `API_DOCS_URL`                           | `http://localhost:4000/api/docs-json` | `pnpm gen:api` — where to read the OpenAPI spec             |
| `E2E_BASE_URL`                           | `http://localhost:3000`               | Playwright — web app under test                             |
| `E2E_API_URL`                            | `http://localhost:4000/api/v1`        | Playwright — API for setup and health checks                |
| `E2E_BUYER_EMAIL` / `E2E_BUYER_PASSWORD` | registered automatically per run      | Playwright — set only to reuse an existing customer account |
| `CI`                                     | unset                                 | Playwright — retries a failed test once                     |

### Deployment notes

- **Real client IPs:** behind this app's `/api/v1` proxy the API sees the web server as the client, which breaks its per-IP login/sign-up rate limits. Put an edge proxy / load balancer in front that **overwrites** `X-Forwarded-For` with the real client IP, and set the API's `TRUST_PROXY_HOPS` to the number of proxies (edge + this app).
- **CSP:** `next.config.ts` builds the Content-Security-Policy from `NEXT_PUBLIC_SOCKET_URL` and `NEXT_PUBLIC_IMAGE_HOSTS`, plus Razorpay's checkout hosts. HSTS is sent in production only.

## 6. Pages

| Portal                        | Routes                                                                                                                                                                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customer `src/app/(customer)` | `/` home · `/events` search & filters · `/events/[slug]` detail + showtimes · `/shows/[id]/seats` live seat map · `/checkout/[bookingId]` · `/bookings` · `/bookings/[id]` (QR ticket, cancel) · `/login` · `/register` |
| Manager `src/app/manager`     | `/manager/login` · `/register` · `/pending` · `/dashboard` (sales, occupancy, CSV) · `/venues` (+ halls, seat layout builder) · `/events` · `/shows` (publish, cancel, block seats, bookings) · `/tickets` (check-in)   |
| Admin `src/app/admin`         | `/admin/login` · `/admin/managers` (approve / suspend)                                                                                                                                                                  |

## 7. How it works

- **Catalog pages are Server Components** cached with `use cache` + `cacheLife` (`src/lib/api/catalog.server.ts`) — prerendered, refreshed every minute. Signed-in pages are Client Components using TanStack Query hooks (`src/lib/api/hooks/`).
- **API types are generated**, never hand-written: `pnpm gen:api` → `src/lib/api/schema.d.ts`; named aliases in `src/lib/api/types.ts`; typed client in `src/lib/api/client.ts` (openapi-fetch).
- **Same-origin API**: the browser calls `/api/v1/*`, which `next.config.ts` rewrites to `API_ORIGIN`. Live seat updates use Socket.IO straight to `NEXT_PUBLIC_SOCKET_URL`.
- **Sessions** (`src/lib/auth/`): one per portal, so customer, organizer and admin can be signed in side by side. The access token is kept in memory only; the refresh token is the API's httpOnly cookie. Refreshes are serialized across tabs (Web Locks) because refresh tokens rotate and reuse revokes the session. `src/proxy.ts` redirects signed-out visitors early using a non-secret hint cookie; `RequireSession` re-checks; the API authorizes every call.
- **Seat locking**: clicking seats only selects them in that tab. Seats are locked (held) when the customer clicks **Proceed to pay**; other open tabs see them turn unavailable within a second over Socket.IO. The API guarantees only one hold can win.
- **Booking safety**: holds, cancellations and payment orders send an `Idempotency-Key` that is reused when the same action is retried. Money is exact integer-paise math (`src/lib/money.ts`) — never floats.
- **Accessibility**: the seat map is an ARIA grid (arrow keys, Space/Enter), seat status uses icon + label (not just color), live regions announce seats taken by others and the checkout countdown at 60 s / 10 s. axe runs in the browser tests.

## 8. Troubleshooting

| Problem                                                              | Fix                                                                                                                       |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Pages show "Something went wrong" / catalog is empty                 | API isn't running or `API_ORIGIN` is wrong — `curl localhost:4000/api/v1/health/ready`                                    |
| Seat map says "offline" / seats don't update live                    | `NEXT_PUBLIC_SOCKET_URL` must point at the API; restart `pnpm dev` after changing it                                      |
| `Port 3000 is already in use`                                        | `lsof -nP -iTCP:3000 -sTCP:LISTEN` then `kill <PID>`                                                                      |
| Styles look stale after pulling changes                              | Stop the dev server, `rm -rf .next`, `pnpm dev`                                                                           |
| Type errors after the API changed                                    | `pnpm gen:api` (API must be running), then `pnpm typecheck`                                                               |
| Dev tools shows a "Minified React error" from `chrome-extension://…` | A browser extension injecting into the page, not the app — use Incognito or set the extension's site access to "On click" |
| Browser tests fail with 429 Too Many Requests                        | API rate limits (sign-up 3/min, login 5/min) — wait a minute between back-to-back `pnpm test:e2e` runs                    |
| Poster images don't show                                             | Add the image host to `NEXT_PUBLIC_IMAGE_HOSTS` and restart                                                               |

Next 16 notes for coding agents: `AGENTS.md`.
