import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';

export const validateBody =
  (schema: ZodType): RequestHandler =>
  (request, response, next) => {
    const result = schema.safeParse(request.body);
    if (!result.success) {
      // Stable code + the Zod issues so the frontend can derive per-field messages.
      return response.status(400).json({ error: 'VALIDATION_FAILED', details: result.error.issues });
    }
    request.body = result.data;
    next();
  };