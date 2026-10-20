---
name: next-page
description: Build a Next.js App Router page for the customer portal, manager portal, or admin portal in the ticketing-web repo — routing, auth gating, data fetching, forms, and UI conventions.
---

# Build a Next.js page

## Where it goes
| Portal | Route group | Access |
|---|---|---|
| Customer | `app/(customer)/...` | public browse; `/checkout/**`, `/bookings/**` need CUSTOMER |
| Manager | `app/manager/(portal)/...` | MANAGER with status ACTIVE (`PENDING_VERIFICATION` → `/manager/pending`) |
| Admin | `app/admin/(portal)/...` | ADMIN |

Login/register pages live outside `(portal)`: `app/login`, `app/register`, `app/manager/login`, `app/manager/register`. Add new protected prefixes to `middleware.ts`.

## Rendering
- Default to **Server Components**. Catalog pages (home, events, event detail) use `fetch` with `next: { revalidate: 60 }` (ISR) and `generateMetadata` for SEO.
- Use `"use client"` only for interactive pieces (seat map, checkout, forms, dashboards) and keep them as leaf components.
- Client data: TanStack Query hooks from `src/lib/api/` — never call `fetch` ad hoc inside components.

## UI conventions
- Tailwind + shadcn/ui components from `src/components/ui`; feature components in `src/components/<feature>/`.
- Forms: react-hook-form + `zodResolver(<shared schema>)`; show field errors and server `error.code` messages.
- Every data view has loading (`loading.tsx` or skeleton), empty, and error states.
- Mobile-first; seat map must be usable on 375 px width (pan/zoom).
- Prices shown with `Intl.NumberFormat('en-IN', { style: 'currency', currency })`; dates in the venue's local time.

## Real-time pages
- Seat map: subscribe to socket namespace `/seats`, room `show:{showId}`, event `seats:update`; merge updates into the query cache; unsubscribe on unmount.
- Checkout: show a countdown from `expiresAt`; on expiry, redirect back to the seat map with a message.

## Done when
- [ ] Route protected correctly (try as the wrong role)
- [ ] Loading/empty/error states present
- [ ] Types come from the generated API client (`src/lib/api/schema.d.ts`)
- [ ] Playwright test for critical flows (booking, manager create show)
