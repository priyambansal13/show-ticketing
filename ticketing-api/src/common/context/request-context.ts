import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

export interface RequestContext {
  requestId?: string;
  ip?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Express middleware: exposes requestId / ip to services (audit rows, outbox headers). */
export function requestContextMiddleware(req: Request & { id?: unknown }, _res: Response, next: NextFunction): void {
  storage.run({ requestId: typeof req.id === 'string' ? req.id : undefined, ip: req.ip }, next);
}

export const currentRequestContext = (): RequestContext => storage.getStore() ?? {};
