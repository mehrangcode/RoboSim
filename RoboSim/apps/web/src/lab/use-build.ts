import type { BuildRequestInput, BuildResult } from '@robosim/shared';
import { useCallback, useState } from 'react';
import { apiPost } from '../lib/api.js';

export interface CompiledSketch {
  readonly result: BuildResult;
  /** Intel HEX, when the build succeeded. */
  readonly hex?: string;
}

/** Compiles through the build service (`POST /builds`) and fetches the firmware it produced. */
export type CompileSketch = (request: BuildRequestInput, locale: string) => Promise<CompiledSketch>;

export const compileWithApi: CompileSketch = async (request, locale) => {
  const result = await apiPost<BuildResult>('/builds', request, locale, crypto.randomUUID());
  if (result.status !== 'succeeded' || !result.artifact) return { result };
  const response = await fetch(result.artifact.url, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching the firmware`);
  return { result, hex: await response.text() };
};

export type BuildState =
  | { readonly status: 'idle' }
  | { readonly status: 'building' }
  | { readonly status: 'done'; readonly result: BuildResult }
  | { readonly status: 'error'; readonly message: string };

export function useBuild(compile: CompileSketch = compileWithApi) {
  const [state, setState] = useState<BuildState>({ status: 'idle' });

  const build = useCallback(
    async (request: BuildRequestInput, locale: string): Promise<CompiledSketch | null> => {
      setState({ status: 'building' });
      try {
        const compiled = await compile(request, locale);
        setState({ status: 'done', result: compiled.result });
        return compiled;
      } catch (e) {
        setState({ status: 'error', message: (e as Error).message });
        return null;
      }
    },
    [compile],
  );
  const clear = useCallback(() => setState({ status: 'idle' }), []);
  return { state, build, clear };
}
