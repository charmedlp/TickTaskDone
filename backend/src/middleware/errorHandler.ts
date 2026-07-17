import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import { AppError } from '../http/errors';

// Wraps an async route so a rejected promise reaches Express' error pipeline
// instead of crashing the process (Express 4 does not await handlers).
type AsyncRequestHandler = (request: Request, response: Response, next: NextFunction) => Promise<unknown>;

export const asyncHandler =
  (handler: AsyncRequestHandler): RequestHandler =>
  (request, response, next) => {
    handler(request, response, next).catch(next);
  };

// Fallthrough for unmatched routes.
export const notFoundHandler: RequestHandler = (_request, response) => {
  response.status(404).json({ error: 'NOT_FOUND' });
};

// Centralized error responder: known AppErrors serialize to their stable code (+ any
// details); everything else is logged and reported as an opaque 500 (no info leak).
// The frontend maps the code to a translated message (i18n brief §2.4).
export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof AppError) {
    response
      .status(error.statusCode)
      .json({ error: error.code, ...(error.details === undefined ? {} : { details: error.details }) });
    return;
  }
  console.error(error);
  response.status(500).json({ error: 'INTERNAL_ERROR' });
};
