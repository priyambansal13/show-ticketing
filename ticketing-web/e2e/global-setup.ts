import { API } from './support';

/**
 * One extra customer for the live-update test, registered once per run straight against the API.
 * The API rate limits registration (3/min per IP) and login (5/min per IP+email), so tests share
 * accounts instead of creating one each. Wait a minute between back-to-back full runs.
 */
export default async function globalSetup() {
  const health = await fetch(`${API}/health/ready`).catch(() => null);
  if (!health?.ok) throw new Error(`API not ready at ${API} — start ticketing-api first (see README).`);
  const email = `e2e-buyer-${Date.now().toString(36)}@example.com`;
  const password = 'Correct-Horse-9';
  const response = await fetch(`${API}/auth/customer/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'E2E Buyer', email, password }),
  });
  if (!response.ok) throw new Error(`Could not register the e2e buyer: ${response.status} ${await response.text()}`);
  process.env.E2E_BUYER_EMAIL = email;
  process.env.E2E_BUYER_PASSWORD = password;
}
