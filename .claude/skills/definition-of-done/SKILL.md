---
name: definition-of-done
description: The mandatory quality gate every task, agent, and phase must pass before being reported as done — build, types, lint, tests, coverage, security, performance, docs. Run it at the end of any implementation work.
---

# Definition of Done

A task is **not done** until every applicable item below is verified *by running it*, not by assumption. Report each gate as ✅ / ❌ / N/A with the actual command output summary. If any gate fails, the status is "not done" — say what failed.

## Gate 1 — Builds & static checks (always)
- [ ] `pnpm typecheck` — zero errors (TypeScript `strict: true`, `noUncheckedIndexedAccess: true`)
- [ ] `pnpm lint` — zero errors **and zero warnings** in changed files
- [ ] `pnpm build` for affected apps succeeds
- [ ] No `any` (explicit or implicit), no `@ts-ignore` / `@ts-expect-error` without a linked reason comment, no `eslint-disable` without reason
- [ ] No `console.log` (use the logger), no commented-out code, no `TODO` without an issue/plan reference

## Gate 2 — Tests (always)
- [ ] New/changed behavior has tests; bug fixes have a regression test that failed before the fix
- [ ] `pnpm test` passes; `pnpm test:int` / `pnpm test:e2e` pass for touched modules (`pnpm test:cov` runs all three and enforces the thresholds below)
- [ ] Coverage thresholds (enforced in Vitest coverage config, CI fails below):
  | Scope | Lines | Branches |
  |---|---|---|
  | `ticketing-api` services overall | ≥ 50% | ≥ 50% |
  | `inventory`, `booking`, `payment` modules | ≥ 50% | ≥ 50% |
  | Seat/booking/payment state transitions | 100% of transitions | — |
  | Mongo schemas & DTO validation | ≥ 90% | — |
- [ ] No flaky tests: no real sleeps, no order dependence, no shared mutable state; poll async effects with `vi.waitFor` (a caught failed `expect()` still fails the test in Vitest)

## Gate 3 — Correctness & contracts (when applicable)
- [ ] API DTOs and generated web types are in sync (`pnpm gen:api` shows no diff); plan §6 API table matches
- [ ] Inventory/booking/payment changes: `booking-integrity` checklist satisfied **and** `booking-integrity-reviewer` reports no critical/high findings
- [ ] DB changes: migration reviewed, backward compatible, plan §4 updated (`db-change`)

## Gate 4 — Security (always for API/auth/web changes)
- [ ] `security-standards` checklist satisfied for the touched surface
- [ ] `pnpm audit --prod` — no high/critical advisories introduced
- [ ] No secrets, tokens, or PII in code, logs, test fixtures, or error messages
- [ ] For auth, payments, uploads, or new public endpoints: `security-reviewer` reports no critical/high findings

## Gate 5 — Performance & accessibility (when applicable)
- [ ] `performance-and-a11y` budgets met for touched endpoints/pages
- [ ] New queries use an index (EXPLAIN checked for hot paths); no N+1

## Gate 6 — Operability (when applicable)
- [ ] `observability` rules: structured logs with requestId, metrics for new business events, errors carry codes
- [ ] New env vars added to zod env schema **and** `.env.example`
- [ ] Health/readiness still green

## Gate 7 — Review & docs (always)
- [ ] `code-reviewer` run on the diff; all critical/high findings fixed, medium ones fixed or explicitly deferred with reason
- [ ] `docs/IMPLEMENTATION_PLAN.md` checkboxes and any diverged sections updated
- [ ] `CLAUDE.md` commands/conventions updated if they changed
- [ ] Commit(s) follow `git-workflow`

## Phase completion (additionally)
- [ ] Phase **Exit** criteria executed literally, output captured
- [ ] Zero open critical/high findings from any reviewer agent
- [ ] Performance budgets for that phase verified (see `performance-and-a11y`)
