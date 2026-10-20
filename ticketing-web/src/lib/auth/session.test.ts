import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PortalSession } from './session';

const user = { id: '00000000-0000-4000-8000-000000000001', email: 'a@example.com', name: 'A', role: 'CUSTOMER', status: 'ACTIVE' } as const;
const auth = (token: string) =>
  new Response(JSON.stringify({ accessToken: token, tokenType: 'Bearer', expiresIn: 900, user }), { status: 200 });

describe('PortalSession', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    document.cookie = 'bms_c_s=1; Path=/';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = 'bms_c_s=; Path=/; Max-Age=0';
  });

  it('shares one refresh between concurrent callers (rotation must not be raced)', async () => {
    fetchMock.mockResolvedValue(auth('t1'));
    const session = new PortalSession('customer');
    const [a, b] = await Promise.all([session.getAccessToken(), session.getAccessToken()]);
    expect(a).toBe('t1');
    expect(b).toBe('t1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reuses a fresh token unless the refresh is forced', async () => {
    fetchMock.mockResolvedValueOnce(auth('t1')).mockResolvedValueOnce(auth('t2'));
    const session = new PortalSession('customer');
    await session.restore();
    expect(await session.refresh()).toBe('t1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await session.refresh({ force: true })).toBe('t2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('signs out and clears the hint when the refresh is rejected', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 401 }));
    const session = new PortalSession('customer');
    await session.restore();
    expect(session.getSnapshot().status).toBe('anonymous');
    expect(document.cookie).not.toContain('bms_c_s=1');
  });

  it('skips the network entirely when this browser never signed in', async () => {
    document.cookie = 'bms_c_s=; Path=/; Max-Age=0';
    const session = new PortalSession('customer');
    await session.restore();
    expect(session.getSnapshot().status).toBe('anonymous');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retries logout once when the server fails, then clears local state', async () => {
    fetchMock
      .mockResolvedValueOnce(auth('t1'))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const session = new PortalSession('customer');
    await session.restore();
    await session.logout();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(session.getSnapshot().status).toBe('anonymous');
  });
});
