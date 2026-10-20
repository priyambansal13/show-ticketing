---
name: performance-and-a11y
description: Performance budgets (API latency, DB queries, caching, frontend Core Web Vitals and bundle size) and accessibility standards (WCAG 2.2 AA, seat map, forms). Use when building or reviewing endpoints, queries, pages, or UI components.
---

# Performance & accessibility standards

## API latency budgets (p95, measured with k6 at target load)
| Endpoint | p95 | Notes |
|---|---|---|
| `GET /events`, `GET /events/:id` | ≤ 100 ms | served from Redis cache on hit |
| `GET /shows/:id/seats` | ≤ 80 ms | layout cached + `avail:*` hash |
| `POST /bookings/hold` | ≤ 200 ms | at 2,000 req/s on a single hot show |
| `POST /payments/webhook/*` | ≤ 300 ms | |
| Auth login | ≤ 300 ms | argon2 dominates — acceptable |
| Error rate under load | < 0.1% non-409 errors | |

## Database rules
- Every query on a hot path has a supporting index; run `EXPLAIN (ANALYZE, BUFFERS)` for new Postgres queries on `show_seats`, `bookings`, `payments` and paste the plan into the PR description when it's not an index scan.
- No N+1: batch with `IN`/`ANY`, Prisma `include` deliberately, Mongo `$in`. Integration tests can assert query count for list endpoints.
- Pagination mandatory on list endpoints (`limit` ≤ 100); prefer keyset pagination for large tables.
- Transactions short: no network calls (payment provider, Kafka, email) inside a DB transaction.
- Prisma pool sized per instance; PgBouncer in transaction mode for production.
- Show publish materializes seats in batches (`createMany`, ≤ 1,000 rows per batch).

## Caching rules
- Cache-aside with explicit TTL; invalidate on write (manager updates event/show → delete keys) via domain event.
- Stampede protection on hot keys (single-flight lock or stale-while-revalidate).
- Never cache per-user data under shared keys.

## Frontend budgets (Lighthouse mobile, production build)
| Metric | Budget |
|---|---|
| LCP | ≤ 2.5 s |
| INP | ≤ 200 ms |
| CLS | ≤ 0.1 |
| Lighthouse Performance | ≥ 90 (catalog pages), ≥ 80 (seat map) |
| Lighthouse Accessibility | ≥ 95 |
| First-load JS per route | ≤ 170 kB gzipped (catalog), ≤ 250 kB (seat map, manager layout builder) |

- `next/image` for posters with explicit sizes; `next/font`; dynamic import for heavy client components (seat map, layout builder, charts).
- Seat map renders ≥ 2,000 seats at 60 fps: SVG with memoized seat components, or canvas above ~3,000 seats; WebSocket updates batched per animation frame.
- Avoid client waterfalls: fetch in Server Components or parallel queries.

## Accessibility — WCAG 2.2 AA
- Semantic HTML first; shadcn/Radix primitives for dialogs, menus, tabs (focus management built in).
- All interactive elements keyboard reachable with visible focus; no keyboard traps; skip-to-content link.
- Color contrast ≥ 4.5:1 text, ≥ 3:1 UI components; **seat status never conveyed by color alone** (pattern/icon + label: available, selected, held, booked, wheelchair).
- **Seat map**: grid semantics (`role="grid"`, rows/gridcells) with arrow-key navigation, `aria-label="Row A seat 5, Gold, ₹450, available"`, `aria-pressed` for selection, live region announcing "Seat A5 was just booked by someone else".
- Checkout countdown announced at 60 s and 10 s via `aria-live="polite"`, not every second; user can request more time once if policy allows (WCAG 2.2.1).
- Forms: labels tied to inputs, errors linked via `aria-describedby`, error summary focused on submit failure.
- Respect `prefers-reduced-motion`.
- Automated: `@axe-core/playwright` in e2e tests — zero serious/critical violations; plus a manual keyboard pass for seat map & checkout each phase.

## Checklist
- [ ] Budgets for touched endpoints/pages checked (k6 smoke or Lighthouse CI)
- [ ] New queries indexed, no N+1, no network calls inside transactions
- [ ] Cache invalidation path defined for new cached data
- [ ] axe clean; keyboard-only walkthrough done for new interactive UI
