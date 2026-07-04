// Application error carrying an HTTP status. The error handler turns it into a
// consistent JSON response without leaking internals. Anything that is not an
// AppError becomes a generic 500.
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string): AppError => new AppError(400, message);
export const notFound = (entity: string): AppError => new AppError(404, `${entity} not found.`);
export const forbidden = (message = 'Forbidden.'): AppError => new AppError(403, message);
