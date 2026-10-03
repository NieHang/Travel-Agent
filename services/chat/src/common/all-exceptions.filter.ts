import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { ApiError, ErrorCode } from '@autix/contracts';
import type { Response } from 'express';
import { AppException } from './app.exception.js';

const GENERIC_MESSAGES: Partial<Record<ErrorCode, string>> = {
  VALIDATION_FAILED: 'Invalid request',
  NOT_FOUND: 'Not found',
  RATE_LIMITED: 'Too many requests',
  INTERNAL_ERROR: 'Internal server error',
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    let status: number;
    let body: ApiError;
    if (exception instanceof AppException) {
      status = exception.getStatus();
      body = {
        code: exception.code,
        message: exception.code,
        ...(exception.details !== undefined && { details: exception.details }),
      };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const code: ErrorCode =
        status === 429
          ? 'RATE_LIMITED'
          : status === 404
            ? 'NOT_FOUND'
            : status >= 400 && status < 500
              ? 'VALIDATION_FAILED'
              : 'INTERNAL_ERROR';
      if (code === 'INTERNAL_ERROR') {
        status = 500;
        this.logger.error(exception);
      }
      body = { code, message: GENERIC_MESSAGES[code] ?? 'Error' };
    } else {
      status = 500;
      this.logger.error(exception);
      body = { code: 'INTERNAL_ERROR', message: GENERIC_MESSAGES.INTERNAL_ERROR! };
    }

    // SSE in progress: headers already sent, cannot write a JSON error body.
    if (res.headersSent) return;
    res.status(status).json(body);
  }
}
