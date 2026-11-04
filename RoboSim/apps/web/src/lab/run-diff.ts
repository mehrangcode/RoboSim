import {
  diffSerialSteps,
  type DiffLine,
  type DiffOptions,
  type SerialDiff,
} from '@robosim/sim-runtime/client';

/**
 * `diffSerialSteps` spread over tasks (≈ `budgetMs` each, `setTimeout` between) so input stays
 * responsive on the worst capped case (Technical Design §18.5). Resolves to null when aborted.
 */
export function diffSerialAsync(
  a: readonly DiffLine[],
  b: readonly DiffLine[],
  opts: DiffOptions = {},
  signal?: AbortSignal,
  budgetMs = 12,
): Promise<SerialDiff | null> {
  const steps = diffSerialSteps(a, b, opts, 8);
  return new Promise((resolve, reject) => {
    const run = () => {
      if (signal?.aborted) return resolve(null);
      try {
        const until = performance.now() + budgetMs;
        for (;;) {
          const r = steps.next();
          if (r.done) return resolve(r.value);
          if (performance.now() >= until) break;
        }
        setTimeout(run, 0);
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };
    run();
  });
}
