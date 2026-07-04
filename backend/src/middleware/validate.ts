import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';

export const validateBody =
  (schema: ZodType): RequestHandler =>
  (request, response, next) => {
    const result = schema.safeParse(request.body);
    if (!result.success) {
      return response.status(400).json({ error: 'Validation failed', details: result.error.issues });
    }
    request.body = result.data;
    next();
  };