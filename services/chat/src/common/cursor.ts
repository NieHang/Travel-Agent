import { AppException } from './app.exception.js';

export function encodeCursor(sortKey: Date, id: string): string {
  return Buffer.from(
    JSON.stringify({ t: sortKey.toISOString(), id }),
  ).toString('base64url');
}

export function decodeCursor(raw: string): { sortKey: Date; id: string } {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    );
    if (typeof parsed === 'object' && parsed !== null) {
      const { t, id } = parsed as { t?: unknown; id?: unknown };
      if (typeof t === 'string' && typeof id === 'string') {
        const sortKey = new Date(t);
        if (!Number.isNaN(sortKey.getTime())) return { sortKey, id };
      }
    }
  } catch {
    // fall through to the validation error below
  }
  throw new AppException('VALIDATION_FAILED', 400);
}
