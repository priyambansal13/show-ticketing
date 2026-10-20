import { ApiError } from '@/lib/api/errors';
import type { AuthResult, Credentials, CustomerRegistration, ManagerRegistration, Portal, User } from '@/lib/api/types';
import { clearSessionHint, hasSessionHint, setSessionHint } from './session-hint';

export type SessionStatus = 'unknown' | 'authenticated' | 'anonymous';
export interface SessionSnapshot {
  status: SessionStatus;
  user: User | null;
}

const UNKNOWN: SessionSnapshot = { status: 'unknown', user: null };
const ANONYMOUS: SessionSnapshot = { status: 'anonymous', user: null };
/** Refresh this long before the access token expires, so in-flight requests never race the expiry. */
const EXPIRY_SKEW_MS = 30_000;

type AuthMessage = { portal: Portal; type: 'login' | 'logout' };

/**
 * One browser session per portal (customer / manager / admin can be signed in side by side).
 *
 * - The access token lives only in memory; the refresh token is an httpOnly cookie the browser
 *   sends to `/api/v1/auth/<portal>/refresh` (same origin through the Next.js rewrite).
 * - Refresh tokens rotate and reuse revokes the whole family, so refreshes are serialized:
 *   in this tab by sharing one promise, across tabs with the Web Locks API — the second tab then
 *   sends the cookie the first tab just received.
 */
export class PortalSession {
  private snapshot: SessionSnapshot = UNKNOWN;
  private accessToken: string | null = null;
  private expiresAt = 0;
  private refreshing: Promise<string | null> | null = null;
  private readonly listeners = new Set<() => void>();
  private channel: BroadcastChannel | null = null;

  constructor(readonly portal: Portal) {}

  // ── React binding (useSyncExternalStore) ────────────────────────────────
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    this.listenAcrossTabs();
    return () => this.listeners.delete(listener);
  };
  getSnapshot = (): SessionSnapshot => this.snapshot;
  getServerSnapshot = (): SessionSnapshot => UNKNOWN;

  /** Resolves the session on first use: refreshes only if this browser has signed in before. */
  async restore(): Promise<SessionSnapshot> {
    if (this.snapshot.status !== 'unknown') return this.snapshot;
    if (!hasSessionHint(this.portal)) {
      this.set(ANONYMOUS);
      return this.snapshot;
    }
    await this.refresh();
    return this.snapshot;
  }

  /** A valid access token, refreshing it when it is about to expire; null when signed out. */
  async getAccessToken(): Promise<string | null> {
    if (this.accessToken && Date.now() < this.expiresAt - EXPIRY_SKEW_MS) return this.accessToken;
    if (this.snapshot.status === 'anonymous') return null;
    return this.refresh();
  }

  /**
   * Gets a new access token. Without `force` a token that is still fresh is reused (e.g. one obtained
   * while we waited for the lock); `force` always asks the API — after a 401, or to pick up a changed
   * account status — unless the token already changed while waiting.
   */
  refresh(options: { force?: boolean } = {}): Promise<string | null> {
    const before = this.accessToken;
    this.refreshing ??= this.withCrossTabLock(() => this.doRefresh(before, options.force ?? false)).finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  async login(credentials: Credentials): Promise<User> {
    return this.authenticate(`/api/v1/auth/${this.portal}/login`, credentials);
  }

  async register(input: CustomerRegistration | ManagerRegistration): Promise<User> {
    if (this.portal === 'admin') throw new Error('Admins cannot self-register');
    return this.authenticate(`/api/v1/auth/${this.portal}/register`, input);
  }

  async logout(): Promise<void> {
    try {
      // The refresh cookie is httpOnly, so only the server can revoke it: retry once on failure.
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await fetch(`/api/v1/auth/${this.portal}/logout`, { method: 'POST', credentials: 'same-origin' }).catch(
          () => null,
        );
        if (response && response.status < 500) break;
      }
    } finally {
      this.clear();
      this.broadcast('logout');
    }
  }

  /**
   * Signs out and leaves with a full page load. Next.js keeps visited pages mounted (hidden) and
   * TanStack Query holds data in memory, so a client-side navigation would leave this user's data in
   * the page for the next person on a shared device.
   */
  async signOut(destination: string): Promise<void> {
    await this.logout().catch(() => undefined);
    window.location.replace(destination);
  }

  /** Called when the API rejects our token outright (revoked, suspended). */
  invalidate(): void {
    this.clear();
  }

  // ── internals ────────────────────────────────────────────────────────────
  private async authenticate(url: string, body: unknown): Promise<User> {
    const response = await safeFetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw await ApiError.fromResponse(response);
    const result = (await response.json()) as AuthResult;
    this.accept(result);
    this.broadcast('login');
    return result.user;
  }

  private async doRefresh(before: string | null, force: boolean): Promise<string | null> {
    const fresh = this.accessToken !== null && Date.now() < this.expiresAt - EXPIRY_SKEW_MS;
    if (fresh && (!force || this.accessToken !== before)) return this.accessToken;
    let response: Response;
    try {
      response = await safeFetch(`/api/v1/auth/${this.portal}/refresh`, { method: 'POST', credentials: 'same-origin' });
    } catch (error) {
      // Offline: keep the current state so the next request can retry; first load counts as signed out.
      if (this.snapshot.status === 'unknown') this.set(ANONYMOUS);
      throw error;
    }
    if (!response.ok) {
      this.clear();
      return null;
    }
    const result = (await response.json()) as AuthResult;
    this.accept(result);
    return result.accessToken;
  }

  private accept(result: AuthResult): void {
    this.accessToken = result.accessToken;
    this.expiresAt = Date.now() + result.expiresIn * 1000;
    setSessionHint(this.portal);
    this.set({ status: 'authenticated', user: result.user });
  }

  private clear(): void {
    this.accessToken = null;
    this.expiresAt = 0;
    clearSessionHint(this.portal);
    this.set(ANONYMOUS);
  }

  private set(next: SessionSnapshot): void {
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }

  private async withCrossTabLock<T>(task: () => Promise<T>): Promise<T> {
    if (typeof navigator !== 'undefined' && 'locks' in navigator) {
      return navigator.locks.request(`bms-refresh-${this.portal}`, task);
    }
    return task();
  }

  private listenAcrossTabs(): void {
    if (this.channel || typeof BroadcastChannel === 'undefined') return;
    this.channel = new BroadcastChannel('bms-auth');
    this.channel.onmessage = (event: MessageEvent<AuthMessage>) => {
      if (event.data.portal !== this.portal) return;
      if (event.data.type === 'logout') {
        const wasSignedIn = this.snapshot.status === 'authenticated';
        this.clear();
        // Signed out in another tab: drop this tab's in-memory data the same way.
        if (wasSignedIn) window.location.reload();
      }
      // Another tab signed in: pick the session up through the (now rotated) refresh cookie.
      else if (this.snapshot.status !== 'authenticated') void this.refresh().catch(() => undefined);
    };
  }

  private broadcast(type: AuthMessage['type']): void {
    this.listenAcrossTabs();
    this.channel?.postMessage({ portal: this.portal, type } satisfies AuthMessage);
  }
}

/** fetch that turns network failures into an ApiError the UI can explain. */
export async function safeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'NETWORK_ERROR', 'Network request failed');
  }
}

const sessions = new Map<Portal, PortalSession>();

export function getSession(portal: Portal): PortalSession {
  let session = sessions.get(portal);
  if (!session) {
    session = new PortalSession(portal);
    sessions.set(portal, session);
  }
  return session;
}
