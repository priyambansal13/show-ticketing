import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Ticket QR payload: `TKT1.<bookingId>.<signature>` where the signature is an
 * HMAC-SHA256 of the booking id. Tamper-evident and verifiable offline by
 * anyone holding the secret; contains no personal data.
 */
const PREFIX = 'TKT1';

const sign = (secret: string, bookingId: string) =>
  createHmac('sha256', secret).update(`${PREFIX}:${bookingId}`).digest('base64url').slice(0, 32);

export function createTicketCode(secret: string, bookingId: string): string {
  return `${PREFIX}.${bookingId}.${sign(secret, bookingId)}`;
}

/** Returns the booking id if the code is authentic, otherwise null. */
export function verifyTicketCode(secret: string, code: string): string | null {
  const [prefix, bookingId, signature] = code.split('.');
  if (prefix !== PREFIX || !bookingId || !signature || !/^[0-9a-f-]{36}$/.test(bookingId)) return null;
  const expected = Buffer.from(sign(secret, bookingId));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual) ? bookingId : null;
}
