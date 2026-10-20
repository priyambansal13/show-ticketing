---
name: implement-phase
description: Pick up the next unfinished phase or task from docs/IMPLEMENTATION_PLAN.md and drive it to its exit criteria. Use when the user says "start phase N", "continue implementation", "next task", or "what's next".
---

# Implement a phase of the ticketing system

## 1. Orient
1. Read `docs/IMPLEMENTATION_PLAN.md` §8 (Phased Delivery). Find the phase the user named, or the first phase with unchecked items.
2. Read the plan sections that phase depends on (data model §4, API §6, booking flow §5, frontend §7).
3. Inspect the current repo state (what already exists under `apps/` and `packages/`) — never assume earlier phases are complete; verify.
4. If an earlier phase's exit criteria are not met, say so and propose finishing it first.

## 2. Plan the slice
- Break the phase into small vertical tasks (schema → API → UI → tests). List them to the user in a short checklist before writing code.
- Identify which project skills apply: `db-change`, `nest-module`, `api-endpoint`, `next-page`, `booking-integrity`.
- Parallelize independent work with project agents when it helps: `data-architect` (schemas), `backend-engineer`, `frontend-engineer`, `test-engineer`. Run `booking-integrity-reviewer` on anything touching inventory/booking/payment.

## 3. Build
- Follow `CLAUDE.md` rules and conventions.
- API contract first (zod DTOs → OpenAPI in ticketing-api), then regenerate web types (`pnpm gen:api` in ticketing-web), so both repos agree.
- Keep each task compiling and tested before moving to the next.

## 4. Quality gate (per task, then per phase)
1. Run the `definition-of-done` skill gates for the task; fix failures before moving on.
2. Run reviewer agents on the diff (in parallel when independent):
   - `code-reviewer` — always
   - `security-reviewer` — auth, any new endpoint, payments, uploads, middleware
   - `booking-integrity-reviewer` — inventory, booking, payment, outbox, Redis holds
3. Fix every **critical/high** finding, then re-run the reviewer that raised it until its verdict is `PASS` / `APPROVED`. Medium findings: fix, or record as deferred with reason in the plan.

## 5. Verify exit criteria
- Execute the phase's **Exit** check literally (e.g. the 500-parallel-holds test in Phase 4) and report the actual output.
- Verify the phase's performance budgets from `performance-and-a11y` where they apply (k6 smoke / Lighthouse).
- Do not claim a phase is done if any exit check, DoD gate, or reviewer verdict fails — report what failed.

## 6. Record progress
- Tick completed checkboxes in `docs/IMPLEMENTATION_PLAN.md`.
- If a decision changed (§0) or the data model/API diverged, update the plan in the same change.
- Update `CLAUDE.md` "Commands" if new scripts were added.
- Summarize: done, verified how, what's next.
