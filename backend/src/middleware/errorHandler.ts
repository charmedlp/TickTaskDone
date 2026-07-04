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
  response.status(404).json({ error: 'Not found.' });
};

// Centralized error responder: known AppErrors keep their status/message,
// everything else is logged and reported as an opaque 500 (no info leak).
export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof AppError) {
    response.status(error.statusCode).json({ error: error.message });
    return;
  }
  console.error(error);
  response.status(500).json({ error: 'Internal server error.' });
};
