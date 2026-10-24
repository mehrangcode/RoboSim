import { csrfResponseSchema, problemDetailsSchema, type ProblemDetails } from '@robosim/shared';

/** An RFC 9457 problem from the API; `title` is already in the language sent as `Accept-Language`. */
export class ApiError extends Error {
  constructor(readonly problem: ProblemDetails) {
    super(problem.title);
    this.name = 'ApiError';
  }
}

let csrfToken: Promise<string | undefined> | undefined;

/**
 * The double-submit CSRF token (API Spec §2) for unsafe requests, fetched once per page. A failure is not cached
 * and does not block the request: endpoints that need the token then answer `csrf_failed`.
 */
function csrf(): Promise<string | undefined> {
  csrfToken ??= Promise.resolve()
    .then(() =>
      fetch('/api/v1/auth/csrf', { credentials: 'same-origin', headers: { Accept: 'application/json' } }),
    )
    .then(async (r) => (r.ok ? csrfResponseSchema.parse(await r.json()).token : undefined))
    .catch(() => undefined)
    .then((token) => {
      if (!token) csrfToken = undefined;
      return token;
    });
  return csrfToken;
}

async function send(path: string, locale: string, init: RequestInit = {}, retried = false): Promise<unknown> {
  const unsafe = !!init.method && !['GET', 'HEAD'].includes(init.method);
  const token = unsafe ? await csrf() : undefined;
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Accept-Language': locale,
      ...(token ? { 'X-CSRF-Token': token } : {}),
      ...init.headers,
    },
    credentials: 'same-origin',
  });
  const body: unknown = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const problem = problemDetailsSchema.safeParse(body);
    // The CSRF cookie can be gone (cleared site data, another tab signed out): fetch a new token, try once more.
    if (problem.success && problem.data.code === 'csrf_failed' && !retried) {
      csrfToken = undefined;
      return send(path, locale, init, true);
    }
    if (problem.success) throw new ApiError(problem.data);
    throw new Error(`HTTP ${response.status} from ${path}`);
  }
  return body;
}

/** JSON GET against `/api/v1`. */
export function apiGet(path: string, locale: string): Promise<unknown> {
  return send(path, locale);
}

/** JSON request with an unsafe method against `/api/v1` (sends the CSRF token). */
export function apiSend(
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body: unknown,
  locale: string,
): Promise<unknown> {
  return send(path, locale, {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
  });
}
