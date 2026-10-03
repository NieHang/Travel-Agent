import type { PipeTransform } from '@nestjs/common';
import type { ZodTypeAny } from 'zod';
import { AppException } from './app.exception.js';

export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodTypeAny) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new AppException('VALIDATION_FAILED', 400, {
        fieldErrors: result.error.flatten().fieldErrors,
      });
    }
    return result.data;
  }
}
