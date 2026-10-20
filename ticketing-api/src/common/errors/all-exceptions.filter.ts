import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '../../generated/prisma/client.js';
import { DomainException } from './domain.exception.js';

export interface ErrorBody {
  error: { code: string; message: string; details?: unknown; requestId?: string };
}

const HTTP_CODES: Partial<Record<number, string>> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'RATE_LIMITED',
  503: 'SERVICE_UNAVAILABLE',
};

/**
 * Every error leaves the API in one shape. Unknown errors become a generic 500:
 * the stack is logged, never returned.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') throw exception;
    const req = host.switchToHttp().getRequest<Request & { id?: string }>();
    const res = host.switchToHttp().getResponse<Response>();
    const { status, body } = this.toResponse(exception);
    // Only our own error shape carries a requestId (pass-through bodies such as health results are left as-is).
    if (typeof body.error.code === 'string') body.error.requestId = req.id;

    const route = req.originalUrl.split('?')[0];
    if (!(exception instanceof HttpException) && !(exception instanceof DomainException) && !(exception instanceof ZodError)) {
      // Unknown failure: needs action (observability skill — level `error`).
      this.logger.error({ err: exception, requestId: req.id, route }, 'Unhandled error');
    } else if (status >= 500) {
      // Deliberate 5xx (e.g. readiness 503, provider 502): handled condition.
      this.logger.warn({ status, requestId: req.id, route, code: body.error.code }, 'Request failed with server status');
    }
    res.status(status).json(body);
  }

  private toResponse(exception: unknown): { status: number; body: ErrorBody } {
    if (exception instanceof DomainException) {
      return {
        status: exception.status,
        body: { error: { code: exception.code, message: exception.message, details: exception.details } },
      };
    }

    if (exception instanceof ZodError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        body: {
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Request validation failed',
            details: exception.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
          },
        },
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        return { status: 409, body: { error: { code: 'CONFLICT', message: 'Resource already exists' } } };
      }
      if (exception.code === 'P2025') {
        return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Resource not found' } } };
      }
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      // Already in our shape (e.g. thrown by a guard or the health controller).
      if (typeof response === 'object' && response !== null && 'error' in response && typeof response.error === 'object') {
        return { status, body: response as ErrorBody };
      }
      const message =
        typeof response === 'object' && response !== null && 'message' in response
          ? String((response as { message: unknown }).message)
          : exception.message;
      return { status, body: { error: { code: HTTP_CODES[status] ?? 'HTTP_ERROR', message } } };
    }

    return { status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } } };
  }
}
