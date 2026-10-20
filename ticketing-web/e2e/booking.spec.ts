import { expect, test } from '@playwright/test';
import { buyer as buyerAccount, expectAccessible, findBookableShow, registerCustomer, signIn } from './support';

test.describe('customer booking', () => {
  test('browse → pick seats → sign up → pay → ticket → cancel', async ({ page, request }) => {
    const { event, showId } = await findBookableShow(request, 2);

    // Browse to the event and its seat map without an account
    await page.goto(`/events/${event.slug}`);
    await expect(page.getByRole('heading', { level: 1, name: event.title })).toBeVisible();
    await page.goto(`/shows/${showId}/seats`);
    const grid = page.getByRole('grid', { name: 'Seat map' });
    await expect(grid).toBeVisible();
    await expect(page.getByText('Live updates on')).toBeVisible();

    // Keyboard: the grid has one tab stop; arrows move, Space selects
    const available = grid.getByRole('button', { name: /, available$/ });
    await available.first().focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(grid.getByRole('button', { pressed: true })).toHaveCount(2);
    const chosen = await grid
      .getByRole('button', { pressed: true })
      .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('data-seat')));
    await expectAccessible(page);

    // Proceeding while signed out sends us to sign-in; the selection survives the round trip
    await page.getByRole('button', { name: 'Proceed to pay' }).click();
    await expect(page).toHaveURL(/\/login\?next=/);
    await page.getByRole('link', { name: 'Create an account' }).click();
    await registerCustomer(page, `/shows/${showId}/seats`);
    await expect(page).toHaveURL(new RegExp(`/shows/${showId}/seats`));
    await expect(page.getByRole('grid', { name: 'Seat map' }).getByRole('button', { pressed: true })).toHaveCount(2);

    // Hold → checkout with countdown → test payment
    await page.getByRole('button', { name: 'Proceed to pay' }).click();
    await expect(page).toHaveURL(/\/checkout\/[0-9a-f-]{36}$/);
    await expect(page.getByText(/Seats held for/)).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('button', { name: /^Pay / }).click();
    const dialog = page.getByRole('dialog', { name: 'Test payment' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Pay (test)' }).click();

    // Confirmed booking with a QR ticket
    await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]{36}\?confirmed=1$/);
    await expect(page.getByText(/You.re all set/)).toBeVisible();
    await expect(page.getByRole('img', { name: /Ticket QR code/ })).toBeVisible();
    await expectAccessible(page);

    // The seats now show as unavailable to everyone
    const bookingUrl = page.url();
    await page.goto(`/shows/${showId}/seats`);
    for (const seatId of chosen) await expect(page.locator(`[data-seat="${seatId}"]`)).toHaveAccessibleName(/, unavailable$/);

    // Cancel (show is ≥ 5 h away, so the policy allows it)
    await page.goto(bookingUrl.replace('?confirmed=1', ''));
    await page.getByRole('button', { name: 'Cancel booking' }).click();
    const cancel = page.getByRole('dialog', { name: 'Cancel this booking?' });
    await cancel.getByRole('button', { name: 'Cancel booking' }).click();
    await expect(page.getByText(/^Cancelled/).first()).toBeVisible();

    // It appears under "Cancelled" in My bookings
    await page.goto('/bookings?status=CANCELLED');
    await expect(page.getByRole('listitem').first()).toBeVisible();
  });

  test('a seat taken by another customer disappears live @mobile', async ({ browser, request }) => {
    const { showId } = await findBookableShow(request, 2);
    const watcher = await browser.newPage();
    await watcher.goto(`/shows/${showId}/seats`);
    await expect(watcher.getByText('Live updates on')).toBeVisible();
    const firstFree = watcher
      .getByRole('grid', { name: 'Seat map' })
      .getByRole('button', { name: /, available$/ })
      .first();
    const seatId = (await firstFree.getAttribute('data-seat')) ?? '';
    const label = (await firstFree.getAttribute('aria-label')) ?? '';
    const target = watcher.locator(`[data-seat="${seatId}"]`);
    await target.click();
    await expect(target).toHaveAttribute('aria-pressed', 'true');

    // Another customer holds the same seat
    const buyer = await browser.newPage();
    await signIn(buyer, `/login?next=${encodeURIComponent(`/shows/${showId}/seats`)}`, buyerAccount());
    await expect(buyer).toHaveURL(new RegExp(`/shows/${showId}/seats`));
    const seatName = label.replace(/, available$/, '');
    await buyer.getByRole('button', { name: `${seatName}, available` }).click();
    await buyer.getByRole('button', { name: 'Proceed to pay' }).click();
    await expect(buyer).toHaveURL(/\/checkout\//);

    // The watcher's selection is dropped and announced
    await expect(watcher.getByText(/was just booked by someone else/).first()).toBeVisible();
    await expect(watcher.getByRole('button', { name: `${seatName}, unavailable` })).toBeVisible();

    // Release the hold so the seat is free again
    const firstCheckout = buyer.url();
    await buyer.getByRole('button', { name: 'Change seats' }).click();
    await expect(buyer).toHaveURL(new RegExp(`/shows/${showId}/seats`));
    await expect(watcher.getByRole('button', { name: `${seatName}, available` })).toBeVisible();

    // Back on the seat map the old selection is gone, and the same seat can be held again (new booking)
    await expect(buyer.getByRole('grid', { name: 'Seat map' }).getByRole('button', { pressed: true })).toHaveCount(0);
    await buyer.getByRole('button', { name: `${seatName}, available` }).click();
    await buyer.getByRole('button', { name: 'Proceed to pay' }).click();
    await expect(buyer).toHaveURL(/\/checkout\//);
    await expect(buyer.getByText(/Seats held for/).filter({ visible: true })).toBeVisible();
    expect(buyer.url()).not.toBe(firstCheckout);
    await buyer.getByRole('button', { name: 'Change seats' }).click();
    await expect(buyer).toHaveURL(new RegExp(`/shows/${showId}/seats`));
  });
});
