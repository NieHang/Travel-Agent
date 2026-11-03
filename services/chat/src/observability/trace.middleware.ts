import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { createLogger } from './logger.js';
import { httpDuration } from './metrics.js';
import { createLlmTotals, newTraceId, runWithTrace } from './trace-context.js';

const TRACE_HEADER = 'x-trace-id';
const accessLog = createLogger('http');

@Injectable()
export class TraceMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const traceId = readTraceId(req) ?? newTraceId();
    res.setHeader(TRACE_HEADER, traceId);
    const startedAt = performance.now();
    const llm = createLlmTotals();
    let logged = false;
    const done = async () => {
      if (logged) return;
      logged = true;
      const durationMs = Math.round(performance.now() - startedAt);
      const route = routeOf(req);
      const aborted = !res.writableFinished;
      // A close listener in the controller aborts the model after this listener runs.
      await llm.whenIdle();
      // finish/close may execute outside the request's async context.
      accessLog.info(
        {
          traceId,
          method: req.method,
          route,
          path: req.path,
          status: res.statusCode,
          durationMs,
          aborted,
          ...(llm.calls > 0
            ? {
                llm: {
                  calls: llm.calls,
                  inputTokens: llm.inputTokens,
                  cachedInputTokens: llm.cachedInputTokens,
                  outputTokens: llm.outputTokens,
                  costUsd: llm.costUsd,
                  estimated: llm.estimated,
                },
              }
            : {}),
        },
        'request completed',
      );
      httpDuration.observe(
        { method: req.method, route, status_code: String(res.statusCode) },
        durationMs / 1000,
      );
    };
    res.on('finish', done);
    res.on('close', done);
    runWithTrace(traceId, () => next(), llm);
  }
}

function readTraceId(req: Request): string | undefined {
  const value = req.headers[TRACE_HEADER];
  return typeof value === 'string' && /^[\w-]{1,64}$/.test(value)
    ? value
    : undefined;
}

function routeOf(req: Request): string {
  return req.route?.path ? `${req.baseUrl}${req.route.path}` : 'unmatched';
}
