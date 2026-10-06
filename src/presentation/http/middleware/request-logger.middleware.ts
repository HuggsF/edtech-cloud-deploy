import { performance } from 'node:perf_hooks';
import type { NextFunction, Request, Response } from 'express';
import type { Logger } from '@application/interfaces/logger';

/** Polled every few seconds by the load balancer and Prometheus: not worth an info line. */
const QUIET_PATHS = new Set(['/health', '/metrics']);

/** One structured log line per request, written when the response is finished. */
export const requestLogger =
  (logger: Logger) =>
  (request: Request, response: Response, next: NextFunction): void => {
    const startedAt = performance.now();
    response.on('finish', () => {
      const context = {
        method: request.method,
        path: request.originalUrl,
        status: response.statusCode,
        durationMs: Math.round(performance.now() - startedAt),
      };
      if (response.statusCode >= 500) {
        logger.error(context, 'HTTP request');
      } else if (QUIET_PATHS.has(request.path)) {
        logger.debug(context, 'HTTP request');
      } else {
        logger.info(context, 'HTTP request');
      }
    });
    next();
  };
