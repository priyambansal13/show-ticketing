import { HttpStatus } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { DomainException } from '../../common/errors/domain.exception.js';
import { API_PREFIX } from '../../bootstrap.js';
import type { Portal } from './dto/auth.dto.js';

/** One cookie per portal, so customer and manager sessions can coexist in one browser. */
export const REFRESH_COOKIE: Record<Portal, string> = { customer: 'bms_c_rt', manager: 'bms_m_rt', admin: 'bms_a_rt' };

export function refreshCookieOptions(portal: Portal, secure: boolean, maxAgeMs: number): CookieOptions {
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    // Only sent to this portal's auth endpoints — never to the rest of the API.
    path: `/${API_PREFIX}/auth/${portal}`,
    maxAge: maxAgeMs,
  };
}

export function setRefreshCookie(res: Response, portal: Portal, token: string, secure: boolean, maxAgeMs: number) {
  res.cookie(REFRESH_COOKIE[portal], token, refreshCookieOptions(portal, secure, maxAgeMs));
}

export function clearRefreshCookie(res: Response, portal: Portal, secure: boolean) {
  const { maxAge: _ignored, ...options } = refreshCookieOptions(portal, secure, 0);
  res.clearCookie(REFRESH_COOKIE[portal], options);
}

export function readRefreshCookie(req: Request, portal: Portal): string | undefined {
  const value = (req.cookies as Record<string, unknown> | undefined)?.[REFRESH_COOKIE[portal]];
  return typeof value === 'string' && value.length > 0 && value.length <= 128 ? value : undefined;
}

/**
 * CSRF defence for the cookie-authenticated endpoints (refresh, logout):
 * SameSite=Lax plus an Origin allow-list check. Requests without an Origin
 * (non-browser clients) are allowed — browsers always send it on POST.
 */
export function assertAllowedOrigin(req: Request, allowedOrigins: readonly string[]): void {
  const origin = req.headers.origin;
  if (origin !== undefined && !allowedOrigins.includes(origin)) {
    throw new DomainException('ORIGIN_NOT_ALLOWED', 'Request origin not allowed', HttpStatus.FORBIDDEN);
  }
}
