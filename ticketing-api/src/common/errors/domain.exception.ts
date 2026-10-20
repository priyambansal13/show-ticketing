import { HttpStatus } from '@nestjs/common';

/**
 * Business-rule failure with a stable, UPPER_SNAKE error code. Rendered by
 * AllExceptionsFilter as `{ error: { code, message, details } }`.
 */
export class DomainException extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: HttpStatus = HttpStatus.BAD_REQUEST,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DomainException';
  }
}

/** Shorthand for the common "not found — or not yours" case (never reveal which). */
export const notFound = (entity: string) =>
  new DomainException(`${entity.toUpperCase()}_NOT_FOUND`, `${entity} not found`, HttpStatus.NOT_FOUND);
