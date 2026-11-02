import type { CodeFacts } from '@robosim/sim-core';
import { useEffect, useState } from 'react';

/** What the analyser reads: the sketch's files. */
type Files = readonly { readonly name: string; readonly content: string }[];

/**
 * Pin facts of the sketch (FR-COD-06 analyser), recomputed `delayMs` after typing stops. The parser is
 * loaded on first use, outside the initial bundle; null until it is ready (and while `wanted` is false).
 */
export function useCodeFacts(files: Files, wanted: boolean, delayMs = 300): CodeFacts | null {
  const [facts, setFacts] = useState<CodeFacts | null>(null);
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    const timer = setTimeout(() => {
      void Promise.all([import('./code-analysis.js'), import('@robosim/code-analysis')]).then(
        async ([{ codeAnalysisReady }, { analyzeSketch }]) => {
          await codeAnalysisReady;
          if (live) setFacts(analyzeSketch(files));
        },
        () => undefined,
      );
    }, delayMs);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [files, wanted, delayMs]);
  return facts;
}
