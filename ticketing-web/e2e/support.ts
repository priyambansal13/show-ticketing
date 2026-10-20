import AxeBuilder from '@axe-core/playwright';
import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const API = process.env.E2E_API_URL ?? 'http://localhost:4000/api/v1';

export const SEED = {
  manager: { email: 'manager@ticketing.local', password: 'ChangeMe!Manager123' },
  customer: { email: 'customer@ticketing.local', password: 'ChangeMe!Customer123' },
  admin: { email: 'admin@ticketing.local', password: 'ChangeMe!Admin123' },
};

/** Registered once per run by global-setup.ts. */
export const buyer = () => ({ email: process.env.E2E_BUYER_EMAIL ?? '', password: process.env.E2E_BUYER_PASSWORD ?? '' });

export const unique = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Registers a brand-new customer through the UI (fresh account → no leftover holds from earlier runs). */
export async function registerCustomer(page: Page, next?: string) {
  const email = `${unique('e2e')}@example.com`;
  await page.goto(next ? `/register?next=${encodeURIComponent(next)}` : '/register');
  await page.getByLabel('Full name').fill('E2E Customer');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('Correct-Horse-9');
  await page.getByRole('button', { name: 'Create account' }).click();
  return email;
}

export async function signIn(page: Page, path: string, credentials: { email: string; password: string }) {
  await page.goto(path);
  await page.getByLabel('Email').fill(credentials.email);
  await page.getByLabel('Password').fill(credentials.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** Zero serious/critical axe violations (WCAG 2.2 AA rules). */
export async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const blocking = results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
  expect(
    blocking.map(
      (violation) =>
        `${violation.id}: ${violation.nodes.map((node) => `${node.target.join(' ')} ${node.html} ${node.failureSummary ?? ''}`).join(', ')}`,
    ),
  ).toEqual([]);
}

/** First upcoming on-sale show with at least `seats` available seats, straight from the API. */
export async function findBookableShow(request: APIRequestContext, seats = 2) {
  const events = (await (await request.get(`${API}/events?limit=50`)).json()) as { data: { id: string; slug: string; title: string }[] };
  for (const event of events.data) {
    const shows = (await (await request.get(`${API}/events/${event.id}/shows`)).json()) as {
      id: string;
      status: string;
      startsAt: string;
      salesOpenAt: string;
    }[];
    for (const show of shows) {
      if (show.status !== 'ON_SALE' || Date.parse(show.startsAt) < Date.now() + 5 * 3_600_000 || Date.parse(show.salesOpenAt) > Date.now())
        continue;
      const map = (await (await request.get(`${API}/shows/${show.id}/seats`)).json()) as { availableSeats: number; salesOpen: boolean };
      if (map.salesOpen && map.availableSeats >= seats) return { event, showId: show.id };
    }
  }
  throw new Error('No bookable show found — run the manager spec or `pnpm db:seed` in ticketing-api first.');
}
