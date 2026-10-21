import type { BuildResult, BuildStatus } from '@robosim/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api.js';
import { createApiCompiler, type BuildProgress } from './use-build.js';

const SHA = 'a'.repeat(64);
const request = { board: 'avr-uno' as const, files: [{ name: 's.ino', content: '' }] };
const succeeded: BuildResult = {
  buildId: 'b1',
  status: 'succeeded',
  cacheHit: false,
  artifact: {
    id: SHA,
    format: 'ihex',
    sha256: SHA,
    sizeBytes: 12,
    flashPct: 3,
    ramPct: 1,
    url: `/api/v1/artifacts/${SHA}`,
  },
  diagnostics: [],
  durationMs: 9,
};
const links = { statusUrl: '/api/v1/builds/b1', eventsUrl: '/api/v1/builds/b1/events' };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Routes `fetch` by method and path. */
function serve(routes: Record<string, () => Response>) {
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(input)}`;
    const route = routes[key];
    if (!route) throw new Error(`unexpected ${key}`);
    return Promise.resolve(route());
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

/** An EventSource the test drives: `emit` sends a named event, `fail` drops the connection for good. */
class FakeEventSource extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static last: FakeEventSource | undefined;
  readyState = FakeEventSource.OPEN;
  constructor(readonly url: string) {
    super();
    FakeEventSource.last = this;
  }
  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
  emit(status: BuildStatus) {
    this.dispatchEvent(new MessageEvent(status.state, { data: JSON.stringify(status) }));
  }
  fail() {
    this.readyState = FakeEventSource.CLOSED;
    this.dispatchEvent(new Event('error'));
  }
}
const compiler = () =>
  createApiCompiler({ EventSourceImpl: FakeEventSource as unknown as typeof EventSource, pollMs: 1 });

const tick = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  vi.unstubAllGlobals();
  FakeEventSource.last = undefined;
});

describe('createApiCompiler (POST /builds, 200 | 202 + SSE)', () => {
  it('uses a cached result (200) directly and fetches the firmware', async () => {
    serve({
      'POST /api/v1/builds': () => json(200, { ...succeeded, cacheHit: true }),
      [`GET ${succeeded.artifact?.url}`]: () => new Response(':00000001FF\n'),
    });
    const compiled = await compiler()(request, 'en');
    expect(compiled).toMatchObject({ hex: ':00000001FF\n', result: { cacheHit: true } });
    expect(FakeEventSource.last).toBeUndefined();
  });

  it('follows a queued build over SSE, reporting its position and the compile phase', async () => {
    serve({
      'POST /api/v1/builds': () => json(202, { buildId: 'b1', state: 'queued', position: 3, ...links }),
      [`GET ${succeeded.artifact?.url}`]: () => new Response(':00000001FF\n'),
    });
    const progress: BuildProgress[] = [];
    const done = compiler()(request, 'en', { onProgress: (p) => progress.push(p) });
    await tick();
    const source = FakeEventSource.last as FakeEventSource;
    expect(source.url).toBe(links.eventsUrl);
    source.emit({ buildId: 'b1', state: 'queued', position: 1 });
    source.emit({ buildId: 'b1', state: 'running' });
    source.emit({ buildId: 'b1', state: 'succeeded', result: succeeded });
    expect((await done).hex).toBe(':00000001FF\n');
    expect(progress).toEqual([
      { phase: 'queued', position: 3 },
      { phase: 'queued', position: 1 },
      { phase: 'running' },
    ]);
    expect(source.readyState).toBe(FakeEventSource.CLOSED);
  });

  it('returns a compile error as a result without fetching firmware', async () => {
    serve({ 'POST /api/v1/builds': () => json(202, { buildId: 'b1', state: 'running', ...links }) });
    const done = compiler()(request, 'en');
    await tick();
    const failed: BuildResult = { ...succeeded, status: 'failed', artifact: undefined };
    delete failed.artifact;
    FakeEventSource.last?.emit({ buildId: 'b1', state: 'failed', result: failed });
    expect(await done).toEqual({ result: failed });
  });

  it('turns a service error state into a localized ApiError', async () => {
    serve({ 'POST /api/v1/builds': () => json(202, { buildId: 'b1', state: 'running', ...links }) });
    const done = compiler()(request, 'fa');
    await tick();
    FakeEventSource.last?.emit({ buildId: 'b1', state: 'error', error: { code: 'internal_error' } });
    const error = await done.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).problem.code).toBe('internal_error');
    expect((error as ApiError).problem.title).not.toBe('internal_error');
  });

  it('falls back to polling when the stream cannot be opened', async () => {
    let polls = 0;
    serve({
      'POST /api/v1/builds': () => json(202, { buildId: 'b1', state: 'queued', position: 2, ...links }),
      'GET /api/v1/builds/b1': () =>
        json(
          200,
          ++polls < 2
            ? { buildId: 'b1', state: 'running' }
            : { buildId: 'b1', state: 'succeeded', result: succeeded },
        ),
      [`GET ${succeeded.artifact?.url}`]: () => new Response(':00000001FF\n'),
    });
    const progress: BuildProgress[] = [];
    const done = compiler()(request, 'en', { onProgress: (p) => progress.push(p) });
    await tick();
    FakeEventSource.last?.fail();
    expect((await done).hex).toBe(':00000001FF\n');
    expect(progress).toEqual([{ phase: 'queued', position: 2 }, { phase: 'running' }]);
  });

  it('stops following when aborted', async () => {
    serve({
      'POST /api/v1/builds': () => json(202, { buildId: 'b1', state: 'queued', position: 1, ...links }),
    });
    const controller = new AbortController();
    const done = compiler()(request, 'en', { signal: controller.signal });
    await tick();
    controller.abort();
    await expect(done).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeEventSource.last?.readyState).toBe(FakeEventSource.CLOSED);
  });
});
