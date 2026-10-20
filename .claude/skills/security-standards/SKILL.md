---
name: security-standards
description: Security requirements for the ticketing platform — authentication, authorization (customer/manager/admin + ownership), input validation, OWASP Top 10, payments/webhooks, secrets, headers, rate limiting, dependencies. Use when building or reviewing auth, API endpoints, payments, file uploads, or web pages that handle user data.
---

# Security standards

Baseline: **OWASP ASVS Level 2** and **OWASP Top 10 (2021)**. Each section lists the rule and how it's enforced.

## A01 Broken access control (highest risk in this app)
- Deny by default: global `JwtAuthGuard`; `@Public()` is an explicit, reviewed exception.
- Role checks via `@Roles()`; **object-level checks on every `:id` route**:
  - customer → `booking.userId === user.sub`
  - manager → resource `managerId === user.sub` (`ManagerOwnershipGuard`), and manager `status === 'ACTIVE'`
  - admin routes `@Roles('ADMIN')` only
- Never trust ids from the body for ownership (`userId`, `managerId` come from the token, never the request).
- Return **404 (not 403)** for resources owned by others to avoid enumeration.
- Tests: for every protected route, a test with the wrong role and a test with another owner's resource.

## A02 Cryptography & secrets
- Passwords: argon2id (memory ≥ 19 MiB, iterations ≥ 2). Never log or return hashes.
- JWT: asymmetric (RS256/EdDSA) or HS256 with ≥ 256-bit secret; validate `iss`, `aud`, `exp`; 15-min access TTL; `alg` pinned.
- Refresh tokens: random ≥ 256 bits, stored hashed (SHA-256), rotated every use, reuse → revoke family.
- Cookies: `HttpOnly; Secure; SameSite=Lax; Path=/api/v1/auth`; separate customer/manager cookie names.
- Secrets only via env; `.env*` git-ignored except `.env.example`; config schema fails fast on missing secrets.

## A03 Injection
- All input validated with zod (body, query, params, headers we read). Unknown keys stripped/rejected.
- Prisma parameterized queries only; `$queryRaw` with tagged templates — **never** `$queryRawUnsafe` with user input.
- Mongo: never pass raw request objects into filters (operator injection, e.g. `{ "$gt": "" }`); build filters from validated fields.
  - `applyMongooseSecurityDefaults()` (global `sanitizeFilter` + `strictQuery`) must run before any connection — the per-connection `sanitizeFilter` option is silently ignored by Mongoose 9.
  - Operators the **server** builds (`$text`, `$in`, `$gte` on dates, …) are wrapped in `mongoose.trusted({...})`. Never wrap anything derived from request data in `trusted()`.
- Redis keys built from validated ids only.
- Output: React escapes by default; **no `dangerouslySetInnerHTML`** with user/manager content (event descriptions rendered as sanitized markdown).

## A04 Insecure design (business logic)
- Max seats per booking (e.g. 10) and max concurrent active holds per user (e.g. 2) to stop seat hoarding.
- Price is always computed server-side from `show_seats.price`; never accepted from the client.
- Payment amount verified against booking total in the webhook before confirming.

## A05 Misconfiguration
- `helmet` with strict CSP on web (no `unsafe-inline` scripts; Razorpay domains allow-listed), HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors 'none'`.
- CORS: explicit origin allow-list from env; credentials only for the web origin.
- Production: Swagger UI disabled or auth-protected; stack traces never returned; `NODE_ENV=production`.

## A06 Vulnerable components
- `pnpm audit --prod` in CI (fail on high/critical); Renovate/Dependabot enabled; lockfile committed; pin exact versions for auth/crypto libs.

## A07 Authentication failures
- Rate limits: login 5/min per IP+email, register 3/min per IP, refresh 30/min per user; generic error "Invalid email or password".
- Account lockout/backoff after repeated failures; password min 10 chars + breached-password check (k-anonymity HIBP) optional.
- Logout revokes refresh token; password change revokes all sessions.

## A08 Integrity — payments & webhooks
- Verify webhook HMAC signature with timing-safe compare on the **raw body**; reject if missing/invalid.
- Dedupe by provider event id; idempotency keys on provider API calls.
- Verify amount, currency and order id match our records.

## A09 Logging & monitoring
- Audit log for: login success/failure, role/status changes, manager approval, event/show publish/cancel, booking/payment/refund state changes.
- Never log: passwords, tokens, cookies, full card/UPI data, OTPs. Redact via pino `redact` paths.

## A10 SSRF & uploads
- Poster/banner uploads: direct-to-S3 presigned URLs, content-type allow-list (jpeg/png/webp), size ≤ 5 MB, server re-validates; never fetch arbitrary user-supplied URLs server-side.

## CSRF
- Access token in `Authorization` header (not cookie) → API is CSRF-safe; the cookie-based `/auth/refresh` and `/auth/logout` require `SameSite` + an `X-CSRF` double-submit token or Origin check.

## Review checklist (copy into reviews)
- [ ] Every new route: guard + role + object-level ownership + tests for wrong role / wrong owner
- [ ] All inputs zod-validated; no raw-unsafe queries; no Mongo operator injection
- [ ] No client-supplied price/userId/managerId trusted
- [ ] Secrets/PII absent from logs & errors
- [ ] Rate limits on auth and booking endpoints
- [ ] Webhook signature + dedupe + amount check
- [ ] Security headers/CORS unchanged or tightened
