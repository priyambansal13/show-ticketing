import createClient, { type Client } from 'openapi-fetch';
import { getSession, safeFetch } from '@/lib/auth/session';
import { ApiError } from './errors';
import type { paths } from './schema';
import type { Portal } from './types';

export type ApiClient = Client<paths>;

/**
 * Browser fetch for one portal: attaches that portal's access token and, if the API answers 401,
 * refreshes once and replays the request. A second 401 signs the portal out.
 */
function authenticatedFetch(portal: Portal) {
  const session = getSession(portal);
  return async (request: Request): Promise<Response> => {
    const replay = request.clone();
    const send = async (req: Request) => {
      const token = await session.getAccessToken();
      if (token) req.headers.set('Authorization', `Bearer ${token}`);
      return safeFetch(req);
    };
    const response = await send(request);
    if (response.status !== 401) return response;
    const token = await session.refresh({ force: true });
    if (!token) return response;
    const retried = await send(replay);
    if (retried.status === 401) session.invalidate();
    return retried;
  };
}

const clients = new Map<Portal | 'public', ApiClient>();

/** Typed client for `portal` (or the public catalog when omitted). Paths are relative: `/api/v1/...`. */
export function api(portal?: Portal): ApiClient {
  const key = portal ?? 'public';
  let client = clients.get(key);
  if (!client) {
    client = createClient<paths>({
      baseUrl: typeof window === 'undefined' ? (process.env.API_ORIGIN ?? 'http://localhost:4000') : '',
      fetch: portal ? authenticatedFetch(portal) : (request) => safeFetch(request),
    });
    clients.set(key, client);
  }
  return client;
}

/** Returns `data` or throws an ApiError — use inside query/mutation functions. */
export async function unwrap<T>(call: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  const { data, error, response } = await call;
  if (error !== undefined || !response.ok) {
    const body = error as { error?: { code?: string; message?: string; details?: unknown; requestId?: string } } | undefined;
    const detail = body?.error;
    throw detail?.code
      ? new ApiError(response.status, detail.code, detail.message ?? response.statusText, detail.details, detail.requestId)
      : new ApiError(response.status, response.status >= 500 ? 'SERVER_ERROR' : 'HTTP_ERROR', response.statusText || 'Request failed');
  }
  return data as T;
}

/** Fresh key per logical action; reuse it when retrying the same action (API: 8–64 chars [A-Za-z0-9_-]). */
export const newIdempotencyKey = (): string => crypto.randomUUID();

/**
 * After a failed attempt, may the retry reuse the same Idempotency-Key?
 * - No response (network error, status 0): the server may have done the work — REUSE, so it replays.
 * - Still processing (REQUEST_IN_PROGRESS): REUSE.
 * - Any other HTTP error, 4xx or 5xx: the API stored that outcome (5xx says "retry with a new key") — ROTATE.
 */
export function shouldRotateIdempotencyKey(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return error.status > 0 && error.code !== 'REQUEST_IN_PROGRESS';
}
