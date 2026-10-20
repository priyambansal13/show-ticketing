import type { Portal } from '@/lib/api/types';

/**
 * A non-secret "this browser has a <portal> session" flag. The real refresh cookie is httpOnly and
 * scoped to `/api/v1/auth/<portal>`, so page requests never carry it; this flag lets `proxy.ts`
 * redirect signed-out visitors before rendering. It grants nothing — the API authorizes every call.
 */
export const SESSION_HINT_COOKIE: Record<Portal, string> = { customer: 'bms_c_s', manager: 'bms_m_s', admin: 'bms_a_s' };

const SEVEN_DAYS = 7 * 24 * 60 * 60;

export function setSessionHint(portal: Portal): void {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${SESSION_HINT_COOKIE[portal]}=1; Path=/; Max-Age=${SEVEN_DAYS}; SameSite=Lax${secure}`;
}

export function clearSessionHint(portal: Portal): void {
  document.cookie = `${SESSION_HINT_COOKIE[portal]}=; Path=/; Max-Age=0; SameSite=Lax`;
}

export function hasSessionHint(portal: Portal): boolean {
  return document.cookie.split('; ').some((pair) => pair === `${SESSION_HINT_COOKIE[portal]}=1`);
}
