import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  NestInterceptor,
  SetMetadata,
  UseInterceptors,
  applyDecorators,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiHeader } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { from, Observable, of, throwError } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import { ZodError } from 'zod';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import type { AuthUser } from '../auth/auth.decorators.js';
import { DomainException } from '../errors/domain.exception.js';

const IDEMPOTENT = 'idempotency:enabled';
const KEY_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const RETENTION_MS = 24 * 3600_000;
/** A claimed key with no response after this long belongs to a crashed request and may be reclaimed. */
const STALE_IN_PROGRESS_MS = 2 * 60_000;

/** Errors raised before any side effect (validation / business rule): the key can be reused. */
const isClientError = (error: unknown) =>
  error instanceof ZodError ||
  (error instanceof DomainException && error.status < 500) ||
  (error instanceof HttpException && error.getStatus() < 500);

/**
 * Marks a mutating route as idempotent: the client must send an
 * `Idempotency-Key` header; repeating the same key with the same body returns
 * the stored response instead of executing again.
 */
export const Idempotent = () =>
  applyDecorators(
    SetMetadata(IDEMPOTENT, true),
    UseInterceptors(IdempotencyInterceptor),
    ApiHeader({ name: 'Idempotency-Key', required: true, description: '8–64 chars [A-Za-z0-9_-], unique per logical request' }),
  );

const hashBody = (body: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(body ?? null))
    .digest('hex');

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.reflector.get<boolean>(IDEMPOTENT, context.getHandler())) return next.handle();

    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const res = context.switchToHttp().getResponse<Response>();
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || !KEY_PATTERN.test(key)) {
      return throwError(() => new DomainException('IDEMPOTENCY_KEY_REQUIRED', 'Send an Idempotency-Key header (8–64 chars [A-Za-z0-9_-])'));
    }
    if (!req.user) return next.handle();

    const id = { userId: req.user.id, route: `${req.method} ${(req.route as { path?: string } | undefined)?.path ?? req.path}`, key };
    const requestHash = hashBody(req.body);

    return from(this.claim(id, requestHash)).pipe(
      mergeMap(({ stored, claimedAt }) => {
        if (stored) {
          res.status(stored.status);
          res.setHeader('Idempotent-Replay', 'true');
          return of(stored.body);
        }
        return next.handle().pipe(
          mergeMap((body: unknown) =>
            from(
              // Conditional on our claim: never overwrite a row another request reclaimed.
              this.prisma.idempotencyKey.updateMany({
                where: { ...id, createdAt: claimedAt },
                data: { responseStatus: res.statusCode, responseBody: (body ?? null) as Prisma.InputJsonValue },
              }),
            ).pipe(mergeMap(() => of(body))),
          ),
          catchError((error: unknown) => {
            // Client errors happen before side effects: free the key so the client may retry with it.
            // Anything else may have committed work already: record the failure so a retry with the
            // same key never executes twice (the client must use a new key).
            const settle = isClientError(error)
              ? this.prisma.idempotencyKey.deleteMany({ where: { ...id, createdAt: claimedAt } })
              : this.prisma.idempotencyKey.updateMany({
                  where: { ...id, createdAt: claimedAt },
                  data: {
                    responseStatus: 500,
                    responseBody: {
                      error: { code: 'INTERNAL_ERROR', message: 'The original request failed; retry with a new Idempotency-Key' },
                    },
                  },
                });
            return from(settle.catch(() => undefined)).pipe(mergeMap(() => throwError(() => error)));
          }),
        );
      }),
    );
  }

  /** Returns the stored response for a completed request, or claims the key (returning the claim time). */
  private async claim(
    id: { userId: string; route: string; key: string },
    requestHash: string,
  ): Promise<{ stored: { status: number; body: unknown } | null; claimedAt: Date }> {
    try {
      const row = await this.prisma.idempotencyKey.create({
        data: { ...id, requestHash, expiresAt: new Date(Date.now() + RETENTION_MS) },
      });
      return { stored: null, claimedAt: row.createdAt };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
    }
    const existing = await this.prisma.idempotencyKey.findUnique({ where: { userId_route_key: id } });
    if (!existing) return this.claim(id, requestHash); // deleted by a failed attempt in between
    const expired = existing.expiresAt <= new Date();
    // A different body never reclaims a live key, even one that looks crashed.
    if (!expired && existing.requestHash !== requestHash) {
      throw new DomainException(
        'IDEMPOTENCY_KEY_REUSED',
        'This Idempotency-Key was used with a different request body',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const crashed = existing.responseStatus === null && existing.createdAt.getTime() < Date.now() - STALE_IN_PROGRESS_MS;
    if (expired || crashed) {
      // Conditional delete: only the request that removes this exact row gets to reclaim it.
      const { count } = await this.prisma.idempotencyKey.deleteMany({ where: { ...id, createdAt: existing.createdAt } });
      if (count === 1) return this.claim(id, requestHash);
    }
    if (existing.requestHash !== requestHash) {
      throw new DomainException(
        'IDEMPOTENCY_KEY_REUSED',
        'This Idempotency-Key was used with a different request body',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (existing.responseStatus === null) {
      throw new DomainException('REQUEST_IN_PROGRESS', 'A request with this Idempotency-Key is still processing', HttpStatus.CONFLICT);
    }
    return { stored: { status: existing.responseStatus, body: existing.responseBody }, claimedAt: existing.createdAt };
  }
}
