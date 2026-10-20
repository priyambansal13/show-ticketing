import { LOG_REDACT_PATHS, resolveRequestId } from './request-id.js';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('resolveRequestId', () => {
  it.each(['trace-123', 'abc.DEF_9:x', 'a'.repeat(64)])('echoes a safe caller id "%s"', (id) => {
    expect(resolveRequestId(id)).toBe(id);
  });

  it.each([undefined, '', 'a b', 'é', '<script>', 'a'.repeat(65), ['x', 'y']])(
    'replaces unsafe or missing id %j with a UUID v7',
    (incoming) => {
      expect(resolveRequestId(incoming)).toMatch(UUID_V7);
    },
  );
});

describe('LOG_REDACT_PATHS', () => {
  it.each(['password', 'refreshToken', 'otp'])('covers %s at root, one level, request body and two levels', (field) => {
    expect(LOG_REDACT_PATHS).toEqual(expect.arrayContaining([field, `*.${field}`, `req.body.${field}`, `*.*.${field}`]));
  });

  it('covers auth and webhook-signature headers', () => {
    expect(LOG_REDACT_PATHS).toEqual(
      expect.arrayContaining(['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-razorpay-signature"]']),
    );
  });
});
