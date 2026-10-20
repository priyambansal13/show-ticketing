import { expect, test } from '@playwright/test';
import { expectAccessible } from './support';

for (const path of ['/', '/events', '/login', '/register', '/manager/login', '/manager/register', '/admin/login']) {
  test(`${path} has no serious accessibility violations @mobile`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectAccessible(page);
  });
}

test('skip link moves focus to the main content', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main$/);
});
