import { v7 as uuidv7 } from 'uuid';

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,64}$/;

/**
 * Accept a caller-supplied X-Request-Id only if it is short and made of safe
 * characters (it is echoed back and written to logs/audit rows); otherwise
 * generate a time-ordered UUID v7.
 */
export function resolveRequestId(incoming: string | string[] | undefined): string {
  return typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : uuidv7();
}

/**
 * pino redact paths. `*.x` only matches one level below the root, so both the
 * root-level and nested request/response locations are listed explicitly.
 */
const SENSITIVE_FIELDS = [
  'password',
  'newPassword',
  'currentPassword',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'otp',
] as const;

export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'req.headers["x-razorpay-signature"]',
  'res.headers["set-cookie"]',
  ...SENSITIVE_FIELDS.flatMap((field) => [field, `*.${field}`, `req.body.${field}`, `*.*.${field}`]),
];
