import type { NextFunction, Request, Response } from 'express';
import type { MetricsService } from './metrics.service.js';

/**
 * Records every request's duration and *final* status (after guards, filters
 * and errors) when the response finishes. The label is the route pattern, never
 * the raw URL — ids would explode label cardinality.
 */
export function httpMetricsMiddleware(metrics: MetricsService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const stop = metrics.httpDuration.startTimer();
    res.on('finish', () => {
      const route = (req.route as { path?: string } | undefined)?.path ?? 'unmatched';
      stop({ method: req.method, route, status: String(res.statusCode) });
    });
    next();
  };
}
