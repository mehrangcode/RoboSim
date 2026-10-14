import { problemDetailsSchema, type ProblemDetails } from '@robosim/shared';

export class ApiError extends Error {
  constructor(readonly problem: ProblemDetails) {
    super(problem.title);
    this.name = 'ApiError';
  }
}

/** JSON fetch against `/api/v1` that turns RFC 9457 responses into typed `ApiError`s. */
export async function apiGet<T>(path: string, locale: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers: { Accept: 'application/json', 'Accept-Language': locale, ...init?.headers },
    credentials: 'same-origin',
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const problem = problemDetailsSchema.safeParse(body);
    if (problem.success) throw new ApiError(problem.data);
    throw new Error(`HTTP ${response.status} from ${path}`);
  }
  return body as T;
}
