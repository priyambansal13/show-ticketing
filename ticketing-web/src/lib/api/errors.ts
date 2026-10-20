import type { ApiErrorBody } from './types';

/** Thrown for every non-2xx API response; `code` is the API's UPPER_SNAKE error code. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static async fromResponse(response: Response): Promise<ApiError> {
    const body = (await response.json().catch(() => null)) as Partial<ApiErrorBody> | null;
    const error = body?.error;
    if (error && typeof error.code === 'string') {
      return new ApiError(response.status, error.code, error.message ?? response.statusText, error.details, error.requestId);
    }
    return new ApiError(response.status, response.status >= 500 ? 'SERVER_ERROR' : 'HTTP_ERROR', response.statusText || 'Request failed');
  }
}

export const isApiError = (value: unknown): value is ApiError => value instanceof ApiError;

/** Human-friendly copy for the codes a user can act on; falls back to the API's message. */
const FRIENDLY: Record<string, string> = {
  INVALID_CREDENTIALS: 'Email or password is incorrect.',
  ACCOUNT_SUSPENDED: 'This account is suspended. Contact support.',
  RATE_LIMITED: 'Too many attempts. Please wait a moment and try again.',
  EMAIL_TAKEN: 'An account with this email already exists. Try signing in.',
  SEATS_UNAVAILABLE: 'Some of those seats were just taken. Pick different seats.',
  TOO_MANY_SEATS: 'You selected more seats than allowed in one booking.',
  TOO_MANY_ACTIVE_HOLDS: 'You already have seats on hold. Finish or release that booking first.',
  SHOW_NOT_ON_SALE: 'Tickets for this show are not on sale.',
  BOOKING_NOT_PENDING: 'This booking is no longer waiting for payment.',
  CANCELLATION_WINDOW_CLOSED: 'It is too close to the show to cancel this booking.',
  PAYMENT_IN_PROGRESS: 'A payment for this booking is already in progress.',
  PAYMENT_PROVIDER_UNAVAILABLE: 'The payment service is unavailable. Please try again shortly.',
  REQUEST_IN_PROGRESS: 'Your previous request is still being processed.',
  FORBIDDEN: 'You do not have access to this.',
  NETWORK_ERROR: 'Cannot reach the server. Check your connection and try again.',
  SERVER_ERROR: 'Something went wrong on our side. Please try again.',
  INTERNAL_ERROR: 'Something went wrong on our side. Please try again.',
};

export function errorMessage(error: unknown): string {
  if (isApiError(error)) return FRIENDLY[error.code] ?? error.message;
  if (error instanceof Error && error.name !== 'Error') return error.message;
  return 'Something went wrong. Please try again.';
}

/** Field errors from a 400 VALIDATION_FAILED response, keyed by dotted path (`address.line1`). */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!isApiError(error) || error.code !== 'VALIDATION_FAILED' || !Array.isArray(error.details)) return {};
  const result: Record<string, string> = {};
  for (const issue of error.details as { path?: unknown; message?: unknown }[]) {
    if (typeof issue.path === 'string' && typeof issue.message === 'string') result[issue.path] = issue.message;
  }
  return result;
}
