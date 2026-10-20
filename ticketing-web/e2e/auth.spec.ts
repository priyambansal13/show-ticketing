import { expect, test } from '@playwright/test';
import { buyer, SEED, signIn } from './support';

test.describe('auth & portal gating', () => {
  test('protected customer pages redirect to sign-in and come back after login', async ({ page }) => {
    await page.goto('/bookings');
    await expect(page).toHaveURL(/\/login\?next=%2Fbookings/);
    await page.getByLabel('Email').fill(SEED.customer.email);
    await page.getByLabel('Password').fill(SEED.customer.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/bookings$/);
    await expect(page.getByRole('heading', { name: 'My bookings' })).toBeVisible();
  });

  test('manager portal requires a manager session', async ({ page }) => {
    await page.goto('/manager/dashboard');
    await expect(page).toHaveURL(/\/manager\/login/);
  });

  test('a customer session does not open the manager portal', async ({ page }) => {
    await signIn(page, '/login', SEED.customer);
    await expect(page).toHaveURL('/');
    await page.goto('/manager/venues');
    await expect(page).toHaveURL(/\/manager\/login/);
  });

  test('wrong password shows a helpful error', async ({ page }) => {
    await signIn(page, '/login', { email: 'nobody-here@example.com', password: 'definitely-wrong' });
    await expect(page.getByRole('alert').filter({ hasText: 'Email or password is incorrect' })).toBeVisible();
  });

  test('open redirects are ignored after sign-in', async ({ page }) => {
    await page.goto('/login?next=//evil.example.com');
    await page.getByLabel('Email').fill(SEED.customer.email);
    await page.getByLabel('Password').fill(SEED.customer.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('http://localhost:3000/');
  });

  test('customer and manager can be signed in side by side, and sign-out is per portal', async ({ page }) => {
    await signIn(page, '/login', buyer());
    await expect(page).toHaveURL('/');
    await signIn(page, '/manager/login', SEED.manager);
    await expect(page).toHaveURL(/\/manager\/dashboard/);
    await page.goto('/bookings');
    await expect(page.getByRole('heading', { name: 'My bookings' })).toBeVisible();
    await page.getByRole('button', { name: /Account menu/ }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
    await page.goto('/manager/dashboard');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page).toHaveURL(/\/manager\/dashboard/);
  });

  test('registering as a manager lands on the pending-approval page', async ({ page }) => {
    await page.goto('/manager/register');
    await page.getByLabel('Full name').fill('E2E Organizer');
    await page.getByLabel('Email').fill(`org-${Date.now()}@example.com`);
    await page.getByLabel('Organisation').fill('E2E Events Pvt Ltd');
    await page.getByLabel('Password').fill('Correct-Horse-9');
    await page.getByRole('button', { name: /Apply for an organizer account/ }).click();
    await expect(page).toHaveURL(/\/manager\/pending/);
    await page.goto('/manager/venues');
    await expect(page).toHaveURL(/\/manager\/pending/);
  });

  // Spread across two accounts: logins are rate limited to 5/min per email.
  for (const [next, account] of [
    ['/%09/example.org', buyer],
    ['/..//example.org', () => SEED.customer],
  ] as const) {
    test(`?next=${next} cannot redirect off-site`, async ({ page }) => {
      await page.goto(`/login?next=${next}`);
      await page.getByLabel('Email').fill(account().email);
      await page.getByLabel('Password').fill(account().password);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page).toHaveURL('http://localhost:3000/');
    });
  }

  test("the next person on a shared browser never sees the previous customer's bookings", async ({ page }) => {
    await signIn(page, '/login?next=/bookings', SEED.customer);
    await expect(page).toHaveURL(/\/bookings$/);
    const items = page.getByRole('main').getByRole('listitem');
    await expect(items.first()).toBeVisible();
    const previous = await items.allInnerTexts();
    await page.getByRole('button', { name: /Account menu/ }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();

    await page.getByRole('link', { name: 'Sign in' }).click();
    await page.getByLabel('Email').fill(buyer().email);
    await page.getByLabel('Password').fill(buyer().password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('link', { name: 'Browse events' }).waitFor();
    await page.getByRole('button', { name: /Account menu/ }).click();
    await page.getByRole('menuitem', { name: 'My bookings' }).click();
    await expect(page.getByRole('heading', { name: 'My bookings' })).toBeVisible();
    await expect(page.getByText('No bookings yet').or(page.getByRole('main').getByRole('listitem').first())).toBeVisible();
    // Compare whole booking rows (title + seats line): event titles alone also appear in the public catalog.
    for (const text of previous) {
      const lines = text.split('\n').filter(Boolean);
      const rows = page
        .getByRole('listitem', { includeHidden: true })
        .filter({ hasText: lines[0] ?? text })
        .filter({ hasText: lines.at(-1) ?? text });
      await expect(rows).toHaveCount(0);
    }
  });
});
