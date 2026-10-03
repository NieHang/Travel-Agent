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

/**
 * 异常自带的 HTTP 状态码。除 HttpException 外，请求体解析等中间件抛出的错误
 * （例如请求体过大，413）也用数字 `status` / `statusCode` 携带状态码。
 */
function statusOf(exception: unknown): number | undefined {
  if (exception instanceof HttpException) return exception.getStatus();
  if (typeof exception !== 'object' || exception === null) return undefined;
  const { status, statusCode } = exception as { status?: unknown; statusCode?: unknown };
  if (typeof status === 'number') return status;
  if (typeof statusCode === 'number') return statusCode;
  return undefined;
}

function codeForStatus(status: number | undefined): ErrorCode {
  if (status === 429) return 'RATE_LIMITED';
  if (status === 404) return 'NOT_FOUND';
  if (status !== undefined && status >= 400 && status < 500) return 'VALIDATION_FAILED';
  return 'INTERNAL_ERROR';
}

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
    } else {
      const code = codeForStatus(statusOf(exception));
      if (code === 'INTERNAL_ERROR') {
        status = 500;
        this.logger.error(exception);
      } else {
        status = statusOf(exception)!;
      }
      body = { code, message: GENERIC_MESSAGES[code] ?? 'Error' };
    }

    // SSE in progress: headers already sent, cannot write a JSON error body.
    if (res.headersSent) return;
    res.status(status).json(body);
  }
}
