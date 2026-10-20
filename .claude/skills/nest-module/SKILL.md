---
name: nest-module
description: Scaffold or extend a NestJS domain module in the ticketing-api repo (auth, users, events, inventory, booking, payment, notification, audit, reports) following project conventions and module-boundary rules.
---

# NestJS domain module

## Layout
```
ticketing-api/src/modules/<name>/
├─ <name>.module.ts
├─ <name>.controller.ts          # thin: validate, call service, map response
├─ <name>.service.ts             # business logic
├─ <name>.repository.ts          # optional: Prisma/Mongoose access isolated here
├─ dto/                          # zod schemas + DTO classes (validation and OpenAPI)
├─ schemas/                      # Mongoose schemas (Mongo-backed modules)
├─ events/                       # domain event payload types + producers/consumers
└─ __tests__/<name>.service.spec.ts
```

## Steps
1. Generate: `pnpm exec nest g module modules/<name>` (and controller/service), then move files into the layout above.
2. Inject infra via providers from `src/infra/` (`PrismaService`, `RedisService`, `KafkaProducer`, Mongoose `@InjectModel`). Never instantiate clients inside a module.
3. **Boundaries**: export only the service(s) other modules need via `exports: [...]`. Other modules must not import this module's repository, Prisma models, or Mongoose models directly.
4. Cross-module side effects → write an `outbox` row in the same transaction; consumers live in the receiving module (`events/*.consumer.ts`).
5. Auth: routes are protected by the global `JwtAuthGuard`. Add `@Public()` for catalog reads, `@Roles('MANAGER')` + `ManagerOwnershipGuard` for manager resources, `@Roles('CUSTOMER')` for booking routes.
6. Errors: throw `DomainException(code, message, httpStatus)`; the global filter renders `{ error: { code, message, details } }`.
7. Config: read via the typed `ConfigService` — add new env vars to the zod env schema and `.env.example`.
8. Register the module in `app.module.ts`.
9. Write unit tests for the service (mock repositories); add integration tests with Testcontainers for DB-heavy logic.

## Checklist before done
- [ ] No cross-module repository/model imports
- [ ] Guards/roles on every non-public route
- [ ] DTOs come from the module's zod schemas (and appear in the OpenAPI document)
- [ ] Tests pass: `pnpm test` and `pnpm test:int`
