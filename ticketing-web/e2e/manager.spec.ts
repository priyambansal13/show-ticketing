import { expect, test } from '@playwright/test';
import { API, expectAccessible, SEED, signIn, unique } from './support';

/** "YYYY-MM-DDTHH:mm" for a datetime-local input, N days from now (entered as IST wall time). */
const localInput = (daysAhead: number, hour: number) => {
  const date = new Date(Date.now() + daysAhead * 86_400_000);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    date,
  );
  return `${day}T${String(hour).padStart(2, '0')}:00`;
};

test('manager creates a venue, seat layout, event and show, then puts it on sale', async ({ page, request }) => {
  const venueName = unique('E2E Venue');
  const title = unique('E2E Premiere');
  await signIn(page, '/manager/login', SEED.manager);
  await expect(page).toHaveURL(/\/manager\/dashboard/);

  // Venue + hall
  await page.goto('/manager/venues/new');
  await page.getByLabel('Venue name').fill(venueName);
  await page.getByLabel('City').fill('bengaluru');
  await page.getByLabel('Address line 1').fill('1 MG Road');
  await page.getByLabel('State').fill('Karnataka');
  await page.getByLabel('Postal code').fill('560001');
  await page.getByRole('button', { name: 'Create venue' }).click();
  await expect(page).toHaveURL(/\/manager\/venues\/[0-9a-f]{24}$/);
  const addHall = page.getByRole('form', { name: 'Add a hall' });
  await addHall.getByLabel('Hall id').fill('audi-1');
  await addHall.getByLabel('Hall name').fill('Audi 1');
  await addHall.getByRole('button', { name: 'Add hall' }).click();

  // Seat layout: default section (5 rows × 10 seats), make one seat wheelchair accessible
  await page.getByRole('link', { name: 'Design layout' }).click();
  await expect(page.getByRole('heading', { name: /Seat layout/ })).toBeVisible();
  const seat = page.getByRole('button', { name: /^Row A seat 1,/ });
  await seat.click();
  await seat.click();
  await expect(seat).toHaveAccessibleName(/Wheelchair/i);
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Save layout' }).click();
  await expect(page.getByText('Saved as version 1.')).toBeVisible();

  // Event
  await page.goto('/manager/events/new');
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Description').fill('An end-to-end test premiere.');
  await page.getByRole('combobox', { name: 'Category' }).selectOption('MOVIE');
  await page.getByLabel('Duration (minutes)').fill('120');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/manager\/events\/[0-9a-f]{24}$/);
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published', { exact: true }).first()).toBeVisible();

  // Show
  await page.goto('/manager/shows/new');
  await page.getByRole('combobox', { name: 'Event', exact: true }).selectOption({ label: title });
  const venueSelect = page.getByRole('combobox', { name: 'Venue', exact: true });
  const venueValue = await venueSelect.locator('option', { hasText: venueName }).getAttribute('value');
  await venueSelect.selectOption(venueValue ?? '');
  await page.getByRole('combobox', { name: 'Hall', exact: true }).selectOption({ index: 1 });
  await page.getByLabel('Starts at').fill(localInput(3, 19));
  await page.getByLabel('Ends at').fill(localInput(3, 22));
  await page.getByLabel('STANDARD').fill('250');
  await page.getByRole('button', { name: 'Create show' }).click();
  await expect(page).toHaveURL(/\/manager\/shows\/[0-9a-f]{24}$/);
  const showId = page.url().split('/').pop() ?? '';
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText(/seats are on sale/i)).toBeVisible();

  // Customers can now see 50 seats, one of them wheelchair accessible
  const map = (await (await request.get(`${API}/shows/${showId}/seats`)).json()) as {
    totalSeats: number;
    sections: { price: string; rows: { seats: { type: string }[] }[] }[];
  };
  expect(map.totalSeats).toBe(50);
  expect(map.sections[0]?.price).toBe('250.00');
  expect(map.sections.flatMap((section) => section.rows.flatMap((row) => row.seats)).filter((s) => s.type === 'WHEELCHAIR')).toHaveLength(
    1,
  );
});

test('manager dashboard and check-in page are reachable and accessible', async ({ page }) => {
  await signIn(page, '/manager/login', SEED.manager);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('link', { name: 'Ticket check-in' }).first().click();
  await expect(page).toHaveURL(/\/manager\/tickets/);
  await expectAccessible(page);
});
