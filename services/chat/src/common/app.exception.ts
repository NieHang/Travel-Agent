import { HttpException } from '@nestjs/common';
import type { ErrorCode } from '@autix/contracts';

export class AppException extends HttpException {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, status: number, details?: unknown) {
    super(code, status);
    this.code = code;
    this.details = details;
  }
}
