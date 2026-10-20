import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_HINT_COOKIE } from '@/lib/auth/session-hint';
import type { Portal } from '@/lib/api/types';

/**
 * Optimistic route protection (Next.js 16 Proxy). Redirects visitors with no session hint to the
 * right portal's login before any page renders. The hint is not a credential: pages re-check the
 * session client-side and the API authorizes every request.
 */
const PROTECTED: { prefix: string; portal: Portal; login: string }[] = [
  { prefix: '/manager', portal: 'manager', login: '/manager/login' },
  { prefix: '/admin', portal: 'admin', login: '/admin/login' },
  { prefix: '/checkout', portal: 'customer', login: '/login' },
  { prefix: '/bookings', portal: 'customer', login: '/login' },
];
const PUBLIC = new Set(['/manager/login', '/manager/register', '/admin/login']);

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC.has(pathname)) return NextResponse.next();
  const rule = PROTECTED.find(({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  if (!rule || request.cookies.get(SESSION_HINT_COOKIE[rule.portal])?.value === '1') return NextResponse.next();
  const login = new URL(rule.login, request.url);
  login.searchParams.set('next', pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ['/manager/:path*', '/admin/:path*', '/checkout/:path*', '/bookings/:path*'],
};
