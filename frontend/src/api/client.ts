import { apiBaseUrl } from '@/config';

// Minimal typed fetch wrapper. Errors surface as ApiError carrying the backend's STABLE
// error CODE (+ any details); the frontend translates it (see lib/errorMessage).
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    const payload = await response
      .json()
      .then((body: { error?: string; details?: unknown }) => body)
      .catch(() => ({}) as { error?: string; details?: unknown });
    throw new ApiError(response.status, payload.error ?? 'INTERNAL_ERROR', payload.details);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
};

export const api = {
  get: <T>(path: string): Promise<T> => request<T>('GET', path),
  post: <T>(path: string, body: unknown): Promise<T> => request<T>('POST', path, body),
  put: <T>(path: string, body: unknown): Promise<T> => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown): Promise<T> => request<T>('PATCH', path, body),
  delete: <T>(path: string): Promise<T> => request<T>('DELETE', path),
};
