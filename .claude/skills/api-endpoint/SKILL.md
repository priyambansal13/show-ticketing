---
name: api-endpoint
description: Add or change an API endpoint end-to-end — shared zod schema, NestJS controller/service with guards, web API client + TanStack Query hook, and tests. Use for any new route listed in IMPLEMENTATION_PLAN §6.
---

# Add an API endpoint end-to-end

1. **Check the plan** — confirm the route, method, role and payload in `docs/IMPLEMENTATION_PLAN.md` §6. If it isn't there, add it to the plan as part of this change.

2. **Contract** (`ticketing-api/src/modules/<domain>/dto/`)
   - `XxxRequestSchema`, `XxxResponseSchema` with zod; export inferred types.
   - Reuse shared enums (`Role`, `BookingStatus`, `SeatStatus`, …).
   - **PATCH schemas must not contain `.default()`** — `z.object(...).partial()` keeps defaults, so absent fields would be filled in and overwrite stored data. Build Create schemas by adding defaults to shared field definitions; build Update schemas from the default-free fields.
   - Use `.strict()` on body schemas (rejects unknown keys / mass assignment).

3. **API** (`ticketing-api/src/modules/<domain>/`)
   - Validate with `@Body(zodPipe(XxxSchema))` / `@Query(...)` / `@Param('id', zodPipe(ObjectIdSchema|UuidSchema))` and document with `@ApiZodBody(XxxSchema)` / `@ApiZodQuery` / `@ApiZodResponse` (`src/common/validation/zod.ts`; nestjs-zod does not support Nest 12).
   - Controller under `/api/v1/...`; pick exactly one access rule:
     `@Public()` · `@Roles('CUSTOMER')` · `@Roles('MANAGER')` + `@UseGuards(ManagerOwnershipGuard)` · `@Roles('ADMIN')`.
   - Mutating customer routes (`POST /bookings/hold`, `POST /payments/initiate`, cancel): add `@Idempotent()` (reads `Idempotency-Key`).
   - Lists return `{ data, meta: { page, limit, total } }`; errors via `DomainException` with UPPER_SNAKE code.
   - Correct status codes: 201 create, 200 read/update, 204 delete, 400 validation, 401/403 auth, 404, 409 conflict (e.g. `SEATS_UNAVAILABLE`).
   - If the endpoint touches seats, bookings or payments → follow the `booking-integrity` skill.

4. **Web** (`ticketing-web/src/lib/api/<domain>.ts`) — first run `pnpm gen:api` to refresh generated types
   - Typed fetcher using the shared response schema (parse in dev).
   - TanStack Query hook (`useXxx` / `useXxxMutation`) with sensible query keys; invalidate related keys on mutation.

5. **Tests**
   - Controller/service unit test, including the 403 for the wrong role.
   - Integration test (supertest) for the happy path + main failure.

6. **Done when** lint, typecheck and tests pass, and the plan's API table matches the implementation.
