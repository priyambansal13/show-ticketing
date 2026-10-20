/**
 * Phase 1 exit criteria: both portals log in independently, roles and account
 * status are enforced, refresh tokens rotate and detect reuse.
 */
import { API, createUser, PASSWORD, resetRateLimits, startApp, uniqueEmail, type TestApp } from './support/app.js';

let t: TestApp;

beforeAll(async () => {
  t = await startApp();
});
afterAll(async () => {
  await t?.close();
});
beforeEach(async () => {
  await resetRateLimits(t);
});

const refreshCookie = (res: { headers: Record<string, unknown> }, name: string) =>
  ((res.headers['set-cookie'] as string[] | undefined) ?? []).find((c) => c.startsWith(`${name}=`))?.split(';')[0];

describe('registration & login', () => {
  it('registers a customer, normalizes the email and sets an httpOnly refresh cookie scoped to the portal', async () => {
    const email = uniqueEmail('Reg').toUpperCase();
    const res = await t.http.post(`${API}/auth/customer/register`).send({ email, password: PASSWORD, name: 'Reg' }).expect(201);
    expect(res.body.user).toMatchObject({ email: email.toLowerCase(), role: 'CUSTOMER', status: 'ACTIVE' });
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('bms_c_rt='))!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth\/customer/);
    expect(cookie).toMatch(/SameSite=Lax/);
  });

  it('rejects a duplicate email for the same role but allows it for another role', async () => {
    const email = uniqueEmail('dup');
    await t.http.post(`${API}/auth/customer/register`).send({ email, password: PASSWORD, name: 'A' }).expect(201);
    const dup = await t.http.post(`${API}/auth/customer/register`).send({ email, password: PASSWORD, name: 'A' }).expect(409);
    expect(dup.body.error.code).toBe('EMAIL_TAKEN');
    await t.http.post(`${API}/auth/manager/register`).send({ email, password: PASSWORD, name: 'A', orgName: 'Org' }).expect(201);
  });

  it('returns the same generic error for a wrong password and for a wrong portal', async () => {
    const customer = await createUser(t, 'CUSTOMER');
    const wrongPassword = await t.http
      .post(`${API}/auth/customer/login`)
      .send({ email: customer.email, password: 'nope-nope-nope' })
      .expect(401);
    const wrongPortal = await t.http.post(`${API}/auth/manager/login`).send({ email: customer.email, password: PASSWORD }).expect(401);
    expect(wrongPassword.body.error).toMatchObject({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
    expect(wrongPortal.body.error).toMatchObject({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
  });

  it('validates input with field-level errors', async () => {
    const res = await t.http.post(`${API}/auth/customer/register`).send({ email: 'bad', password: 'short', extra: 1 }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual(expect.arrayContaining(['email', 'password', 'name']));
  });
});

describe('roles and manager approval', () => {
  it('blocks a pending manager from manager routes until an admin approves them', async () => {
    const reg = await t.http
      .post(`${API}/auth/manager/register`)
      .send({ email: uniqueEmail('pending'), password: PASSWORD, name: 'Pending', orgName: 'Pending Org' })
      .expect(201);
    expect(reg.body.user.status).toBe('PENDING_VERIFICATION');
    const managerAuth = { Authorization: `Bearer ${reg.body.accessToken as string}` };
    const blocked = await t.http.get(`${API}/manager/venues`).set(managerAuth).expect(403);
    expect(blocked.body.error.code).toBe('ACCOUNT_NOT_ACTIVE');

    const admin = await createUser(t, 'ADMIN');
    const pending = await t.http.get(`${API}/admin/managers?status=PENDING_VERIFICATION&limit=100`).set(admin.auth).expect(200);
    expect(pending.body.data.map((m: { id: string }) => m.id)).toContain(reg.body.user.id);
    await t.http
      .post(`${API}/admin/managers/${reg.body.user.id as string}/approve`)
      .set(admin.auth)
      .expect(200);

    // Status lives in the access token: sign in again to get an ACTIVE one.
    const login = await t.http.post(`${API}/auth/manager/login`).send({ email: reg.body.user.email, password: PASSWORD }).expect(200);
    await t.http
      .get(`${API}/manager/venues`)
      .set({ Authorization: `Bearer ${login.body.accessToken as string}` })
      .expect(200);
  });

  it('forbids customers on manager and admin routes, and anonymous access to protected routes', async () => {
    const customer = await createUser(t, 'CUSTOMER');
    expect((await t.http.get(`${API}/manager/venues`).set(customer.auth).expect(403)).body.error.code).toBe('FORBIDDEN');
    expect((await t.http.get(`${API}/admin/managers`).set(customer.auth).expect(403)).body.error.code).toBe('FORBIDDEN');
    expect((await t.http.get(`${API}/auth/me`).expect(401)).body.error.code).toBe('UNAUTHORIZED');
    await t.http.get(`${API}/auth/me`).set({ Authorization: 'Bearer not-a-jwt' }).expect(401);
  });

  it('suspending a manager ends their sessions (refresh fails)', async () => {
    const email = uniqueEmail('susp');
    const reg = await t.http
      .post(`${API}/auth/manager/register`)
      .send({ email, password: PASSWORD, name: 'S', orgName: 'Susp Org' })
      .expect(201);
    const cookie = refreshCookie(reg, 'bms_m_rt')!;
    const admin = await createUser(t, 'ADMIN');
    await t.http
      .post(`${API}/admin/managers/${reg.body.user.id as string}/suspend`)
      .set(admin.auth)
      .expect(200);
    await t.http.post(`${API}/auth/manager/refresh`).set('Cookie', cookie).expect(401);
    expect((await t.http.post(`${API}/auth/manager/login`).send({ email, password: PASSWORD }).expect(403)).body.error.code).toBe(
      'ACCOUNT_SUSPENDED',
    );
  });
});

describe('refresh tokens', () => {
  it('rotates on every refresh and revokes the whole family when an old token is replayed', async () => {
    const email = uniqueEmail('rot');
    const reg = await t.http.post(`${API}/auth/customer/register`).send({ email, password: PASSWORD, name: 'R' }).expect(201);
    const first = refreshCookie(reg, 'bms_c_rt')!;

    const r1 = await t.http.post(`${API}/auth/customer/refresh`).set('Cookie', first).expect(200);
    const second = refreshCookie(r1, 'bms_c_rt')!;
    expect(second).not.toBe(first);
    expect(r1.body.accessToken).toEqual(expect.any(String));

    // Replay of the rotated token = theft signal → family revoked, even the newest token dies.
    await t.http.post(`${API}/auth/customer/refresh`).set('Cookie', first).expect(401);
    await t.http.post(`${API}/auth/customer/refresh`).set('Cookie', second).expect(401);
  });

  it('does not accept a customer refresh token on the manager portal', async () => {
    const reg = await t.http
      .post(`${API}/auth/customer/register`)
      .send({ email: uniqueEmail('x'), password: PASSWORD, name: 'X' })
      .expect(201);
    const value = refreshCookie(reg, 'bms_c_rt')!.split('=')[1];
    await t.http.post(`${API}/auth/manager/refresh`).set('Cookie', `bms_m_rt=${value}`).expect(401);
  });

  it('rejects refresh from a foreign Origin (CSRF) and logout revokes the session', async () => {
    const reg = await t.http
      .post(`${API}/auth/customer/register`)
      .send({ email: uniqueEmail('lo'), password: PASSWORD, name: 'L' })
      .expect(201);
    const cookie = refreshCookie(reg, 'bms_c_rt')!;
    const csrf = await t.http.post(`${API}/auth/customer/refresh`).set('Cookie', cookie).set('Origin', 'https://evil.example').expect(403);
    expect(csrf.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
    await t.http.post(`${API}/auth/customer/logout`).set('Cookie', cookie).set('Origin', 'http://localhost:3000').expect(204);
    await t.http.post(`${API}/auth/customer/refresh`).set('Cookie', cookie).expect(401);
  });
});

describe('rate limiting', () => {
  it('limits login attempts per IP + email', async () => {
    const email = uniqueEmail('rl');
    const attempts = [];
    for (let i = 0; i < 6; i++)
      attempts.push((await t.http.post(`${API}/auth/customer/login`).send({ email, password: 'wrong-password' })).status);
    expect(attempts.slice(0, 5).every((s) => s === 401)).toBe(true);
    expect(attempts[5]).toBe(429);
  });
});
