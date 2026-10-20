---
name: git-workflow
description: Branching, commit message, pull request, and CI rules for the ticketing system repo. Use when creating branches, committing, opening PRs, or setting up CI.
---

# Git workflow

## Branches
- `main` is always releasable and protected (PR + green CI + review required; no force-push).
- Feature branches: `feat/<phase>-<short-name>` (e.g. `feat/p4-seat-holds`), `fix/<short-name>`, `chore/<short-name>`.
- One branch = one coherent change; keep PRs ≤ ~400 changed lines excluding generated files/migrations where possible.

## Commits — Conventional Commits
```
<type>(<scope>): <imperative summary ≤ 72 chars>

<why, not what — optional body>

Refs: IMPLEMENTATION_PLAN Phase N
```
- `type`: feat, fix, refactor, perf, test, docs, chore, build, ci
- `scope`: auth, users, events, inventory, booking, payment, notification, audit, reports, web, shared, infra
- Breaking API change → `feat(api)!:` + `BREAKING CHANGE:` footer.
- Never commit: `.env`, secrets, `node_modules`, build output, coverage, large binaries.
- Only commit/push when the user asks.

## Pull requests
PR description template:
```
## What & why
## Plan reference (phase / checklist items)
## How verified (commands + results)
## Definition of Done (paste gate results)
## Reviewer findings (code / security / booking-integrity) and resolution
## Screenshots (UI) / EXPLAIN plans (hot queries)
## Risk & rollback
```

## CI (`.github/workflows/ci.yml`) — required checks
1. install (pnpm, cached) → 2. lint (warnings as errors) → 3. typecheck → 4. unit tests + coverage thresholds → 5. integration tests (Testcontainers) → 6. build → 7. `pnpm audit --prod --audit-level=high` → 8. Playwright e2e + axe (ticketing-web) → 9. Lighthouse CI (ticketing-web, catalog pages).
- Two repos, two pipelines: ticketing-api runs steps 1–7 (+ `pnpm db:drift`); ticketing-web runs 1–4, 6–9. Contract check in web CI: regenerate API types and fail on diff.
- Prisma migration check: `prisma migrate diff` must show no drift.

## Releases
- Squash-merge to `main`; tags `vX.Y.Z` (semver) per phase milestone; changelog generated from commits.
