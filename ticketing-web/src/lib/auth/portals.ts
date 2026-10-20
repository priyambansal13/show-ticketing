import type { Portal, Role } from '@/lib/api/types';

export const PORTAL_ROLE: Record<Portal, Role> = { customer: 'CUSTOMER', manager: 'MANAGER', admin: 'ADMIN' };
export const LOGIN_PATH: Record<Portal, string> = { customer: '/login', manager: '/manager/login', admin: '/admin/login' };
export const HOME_PATH: Record<Portal, string> = { customer: '/', manager: '/manager/dashboard', admin: '/admin/managers' };

const BASE = 'http://internal.invalid';
const under = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

/**
 * Post-login destinations must stay on this site (no open redirects) and inside the portal they
 * belong to. The value is parsed as a URL — browsers strip tab/CR/LF while parsing, so string checks
 * alone are bypassable (`/\t/evil.com`) — and control characters are rejected outright.
 */
export function safeNextPath(next: string | null | undefined, portal: Portal): string {
  if (!next || !next.startsWith('/') || /[\u0000-\u001F\u007F\\]/.test(next)) return HOME_PATH[portal];
  let url: URL;
  try {
    url = new URL(next, BASE);
  } catch {
    return HOME_PATH[portal];
  }
  if (url.origin !== BASE) return HOME_PATH[portal];
  const inManager = under(url.pathname, '/manager');
  const inAdmin = under(url.pathname, '/admin');
  if (portal === 'manager' && !inManager) return HOME_PATH.manager;
  if (portal === 'admin' && !inAdmin) return HOME_PATH.admin;
  if (portal === 'customer' && (inManager || inAdmin)) return HOME_PATH.customer;
  // Re-check what we return: dot segments normalize (`/..//evil.com` → `//evil.com`, protocol-relative).
  const result = url.pathname + url.search + url.hash;
  if (result.startsWith('//') || new URL(result, BASE).origin !== BASE) return HOME_PATH[portal];
  return result;
}
