import { resources } from '@robosim/i18n';
import {
  buildAcceptedSchema,
  buildResultSchema,
  buildStatusSchema,
  isTerminalBuildState,
  negotiateLocale,
  type BuildRequestInput,
  type BuildResult,
  type BuildStatus,
} from '@robosim/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiGet, apiPostWithStatus } from '../lib/api.js';

export interface CompiledSketch {
  readonly result: BuildResult;
  /** Intel HEX, when the build succeeded. */
  readonly hex?: string;
}

/** Where a queued build is: waiting at `position` (1 = next), or compiling. */
export type BuildProgress =
  { readonly phase: 'queued'; readonly position: number } | { readonly phase: 'running' };

export interface CompileOptions {
  readonly onProgress?: (progress: BuildProgress) => void;
  /** Stops following the build (the server still finishes it, and its result lands in the cache). */
  readonly signal?: AbortSignal;
}

/** Compiles through the build service (`POST /builds`) and fetches the firmware it produced. */
export type CompileSketch = (
  request: BuildRequestInput,
  locale: string,
  options?: CompileOptions,
) => Promise<CompiledSketch>;

const progressOf = (s: BuildStatus): BuildProgress | undefined =>
  s.state === 'queued'
    ? { phase: 'queued', position: s.position ?? 1 }
    : s.state === 'running'
      ? { phase: 'running' }
      : undefined;

const aborted = () => new DOMException('The build was abandoned', 'AbortError');

/** Resolves with the final status of a queued build: SSE first, polling when the stream is unavailable. */
function follow(
  status: { statusUrl: string; eventsUrl: string },
  locale: string,
  options: CompileOptions,
  EventSourceImpl: typeof EventSource | undefined,
  pollMs: number,
): Promise<BuildStatus> {
  const { onProgress, signal } = options;
  const statusPath = status.statusUrl.replace(/^\/api\/v1/, '');

  const poll = async (): Promise<BuildStatus> => {
    for (;;) {
      if (signal?.aborted) throw aborted();
      const s = buildStatusSchema.parse(await apiGet(statusPath, locale, signal ? { signal } : {}));
      if (isTerminalBuildState(s.state)) return s;
      const p = progressOf(s);
      if (p) onProgress?.(p);
      await new Promise((r) => setTimeout(r, pollMs));
    }
  };
  if (!EventSourceImpl) return poll();

  return new Promise<BuildStatus>((resolve, reject) => {
    const source = new EventSourceImpl(status.eventsUrl, { withCredentials: true });
    const done = (fn: () => void) => {
      source.close();
      signal?.removeEventListener('abort', onAbort);
      fn();
    };
    const onAbort = () => done(() => reject(aborted()));
    signal?.addEventListener('abort', onAbort, { once: true });
    const onStatus = (e: Event) => {
      const s = buildStatusSchema.parse(JSON.parse((e as MessageEvent<string>).data));
      if (isTerminalBuildState(s.state)) done(() => resolve(s));
      else {
        const p = progressOf(s);
        if (p) onProgress?.(p);
      }
    };
    for (const name of ['queued', 'running', 'succeeded', 'failed']) source.addEventListener(name, onStatus);
    // The `error` event is both the build's `error` state (with data) and a connection failure (without).
    source.addEventListener('error', (e) => {
      if (e instanceof MessageEvent && typeof e.data === 'string' && e.data) onStatus(e);
      else if (source.readyState === EventSourceImpl.CLOSED) done(() => poll().then(resolve, reject));
      // Otherwise the browser reconnects by itself, and the server resends the current status.
    });
  });
}

/** A `CompileSketch` against the API; `EventSource` and the polling interval are injectable for tests. */
export function createApiCompiler({
  EventSourceImpl = globalThis.EventSource as typeof EventSource | undefined,
  pollMs = 1000,
}: { EventSourceImpl?: typeof EventSource | undefined; pollMs?: number } = {}): CompileSketch {
  return async (request, locale, options = {}) => {
    const created = await apiPostWithStatus('/builds', request, locale, crypto.randomUUID());
    let result: BuildResult;
    if (created.status === 202) {
      const accepted = buildAcceptedSchema.parse(created.body);
      const p = progressOf(accepted);
      if (p) options.onProgress?.(p);
      const final = isTerminalBuildState(accepted.state)
        ? accepted
        : await follow(accepted, locale, options, EventSourceImpl, pollMs);
      if (!final.result) {
        const code = final.error?.code ?? 'internal_error';
        throw new ApiError({
          type: code,
          title: resources[negotiateLocale(locale)].errors[code],
          status: 500,
          code,
          requestId: final.buildId,
        });
      }
      result = final.result;
    } else result = buildResultSchema.parse(created.body);
    if (result.status !== 'succeeded' || !result.artifact) return { result };
    const response = await fetch(result.artifact.url, {
      credentials: 'same-origin',
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} fetching the firmware`);
    return { result, hex: await response.text() };
  };
}

export const compileWithApi: CompileSketch = createApiCompiler();

export type BuildState =
  | { readonly status: 'idle' }
  | { readonly status: 'building'; readonly progress?: BuildProgress }
  | { readonly status: 'done'; readonly result: BuildResult }
  | { readonly status: 'error'; readonly message: string; readonly cause?: unknown };

export function useBuild(compile: CompileSketch = compileWithApi) {
  const [state, setState] = useState<BuildState>({ status: 'idle' });
  const current = useRef<AbortController | null>(null);
  useEffect(() => () => current.current?.abort(), []);

  const build = useCallback(
    async (request: BuildRequestInput, locale: string): Promise<CompiledSketch | null> => {
      current.current?.abort();
      const controller = new AbortController();
      current.current = controller;
      setState({ status: 'building' });
      try {
        const compiled = await compile(request, locale, {
          signal: controller.signal,
          onProgress: (progress) => {
            if (!controller.signal.aborted) setState({ status: 'building', progress });
          },
        });
        if (controller.signal.aborted) return null;
        setState({ status: 'done', result: compiled.result });
        return compiled;
      } catch (e) {
        if (controller.signal.aborted) return null;
        setState({
          status: 'error',
          message: e instanceof ApiError ? e.problem.title : (e as Error).message,
          cause: e,
        });
        return null;
      }
    },
    [compile],
  );
  const clear = useCallback(() => setState({ status: 'idle' }), []);
  return { state, build, clear };
}
