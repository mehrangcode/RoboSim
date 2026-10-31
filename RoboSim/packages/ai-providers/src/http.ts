import { ProviderError, type ProviderOptions } from './types.js';

/** Rough token count: ~4 Latin characters per token, ~2 for Persian and other non-ASCII scripts. */
export function estimateTokens(text: string): number {
  let ascii = 0;
  let other = 0;
  for (const ch of text) {
    if (ch.charCodeAt(0) < 128) ascii++;
    else other++;
  }
  return Math.ceil(ascii / 4 + other / 2);
}

/** Message a provider put in its error body (`{error:{message}}` in all three API families). */
async function errorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    const body = JSON.parse(text) as { error?: { message?: unknown } | string; message?: unknown };
    const m = typeof body.error === 'string' ? body.error : (body.error?.message ?? body.message);
    if (typeof m === 'string' && m) return m.slice(0, 500);
  } catch {
    // not JSON
  }
  return text.slice(0, 300) || `HTTP ${res.status}`;
}

export async function request(
  opts: ProviderOptions,
  url: string,
  init: Omit<RequestInit, 'signal'> & { signal?: AbortSignal | undefined },
): Promise<Response> {
  const doFetch = opts.fetch ?? fetch;
  // Time limit up to the response headers only: a slow model may stream for minutes after that.
  const timer = new AbortController();
  const timeout = setTimeout(
    () => timer.abort(new DOMException('timed out', 'TimeoutError')),
    opts.timeoutMs ?? 60_000,
  );
  const signal = init.signal ? AbortSignal.any([init.signal, timer.signal]) : timer.signal;
  const { signal: _caller, ...rest } = init;
  let res: Response;
  try {
    res = await doFetch(url, { ...rest, signal });
  } catch (e) {
    if (init.signal?.aborted) throw e;
    const why = e instanceof Error ? (e.name === 'TimeoutError' ? 'timed out' : e.message) : String(e);
    throw new ProviderError(`could not reach the provider (${why})`, 0);
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) throw new ProviderError(await errorMessage(res), res.status);
  return res;
}

export async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Server-sent events from a response body: `data` lines joined, `[DONE]` passed through. */
export async function* sse(res: Response): AsyncGenerator<{ event: string; data: string }> {
  if (!res.body) return;
  const decoder = new TextDecoder();
  let buffer = '';
  let event = 'message';
  let data: string[] = [];
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, '');
        buffer = buffer.slice(nl + 1);
        if (line === '') {
          if (data.length) yield { event, data: data.join('\n') };
          event = 'message';
          data = [];
        } else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
        else if (line.startsWith('event:')) event = line.slice(6).trim();
      }
      if (done) break;
    }
    if (data.length) yield { event, data: data.join('\n') };
  } finally {
    reader.releaseLock();
  }
}

export function parseArgs(raw: string): unknown {
  if (raw.trim() === '') return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export const trimSlash = (url: string): string => url.replace(/\/+$/, '');
