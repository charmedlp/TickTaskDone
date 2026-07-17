import type { ErrorCode } from '@ticktaskdone/shared';

// Application error carrying an HTTP status and a STABLE, locale-independent code
// (i18n brief §2.4). The error handler serializes it as `{ error: <code>, details? }`;
// the frontend translates the code. Anything that is not an AppError becomes a generic
// 500 with code INTERNAL_ERROR. `message` (set to the code) exists only for logs.
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ErrorCode,
    public readonly details?: unknown,
  ) {
    super(code);
    this.name = 'AppError';
  }
}

export const badRequest = (code: ErrorCode, details?: unknown): AppError => new AppError(400, code, details);
export const notFound = (entity: string): AppError => new AppError(404, 'NOT_FOUND', { entity });
export const conflict = (code: ErrorCode, details?: unknown): AppError => new AppError(409, code, details);
