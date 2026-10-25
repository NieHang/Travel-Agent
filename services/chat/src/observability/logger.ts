import pino, { type Logger } from 'pino';
import { getTraceId } from './trace-context.js';

export function traceMixin(): { traceId?: string } {
  const traceId = getTraceId();
  return traceId ? { traceId } : {};
}

export const loggerOptions: pino.LoggerOptions = {
  level: process.env.LOG_LEVEL ?? 'info',
  mixin: traceMixin,
  redact: {
    paths: [
      'apiKey',
      '*.apiKey',
      'password',
      '*.password',
      'authorization',
      '*.authorization',
      'headers.authorization',
      'req.headers.authorization',
      'headers.cookie',
      'req.headers.cookie',
    ],
    censor: '[REDACTED]',
  },
};

// Avoid worker-thread transports: Bun uses the pretty stream directly.
const logger: Logger =
  process.env.LOG_PRETTY === '1'
    ? pino(
        loggerOptions,
        (await import('pino-pretty')).default({ colorize: true }),
      )
    : pino(loggerOptions);

export function createLogger(module: string): Logger {
  return logger.child({ module });
}
