import type { GradeJob, GradeResult } from '@robosim/sim-runtime/client';
import { useCallback, useEffect, useRef, useState } from 'react';

/** A verified run without its trace (the worker sends the trace's digest instead). */
export type VerifiedRun = Omit<GradeResult, 'trace'>;

export type VerifyReply =
  | {
      readonly type: 'graded';
      readonly result: VerifiedRun;
      readonly samples: number;
      readonly digest: string;
      readonly wallMs: number;
    }
  | { readonly type: 'error'; readonly message: string };

export type VerifyState =
  | { readonly status: 'idle' }
  | { readonly status: 'grading' }
  | (Extract<VerifyReply, { type: 'graded' }> & { readonly status: 'done' })
  | { readonly status: 'error'; readonly message: string };

export interface GradeWorkerLike {
  postMessage(job: GradeJob): void;
  onmessage: ((event: MessageEvent<VerifyReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  terminate(): void;
}

export const createGradeWorker = (): GradeWorkerLike =>
  new Worker(new URL('./grade.worker.ts', import.meta.url), {
    type: 'module',
    name: 'robosim-grade',
  }) as unknown as GradeWorkerLike;

/** Grades runs in a short-lived worker of its own; a new request cancels the one in flight. */
export function useVerifiedRun(createWorker: () => GradeWorkerLike = createGradeWorker) {
  const [state, setState] = useState<VerifyState>({ status: 'idle' });
  const worker = useRef<GradeWorkerLike | null>(null);

  const stop = useCallback(() => {
    worker.current?.terminate();
    worker.current = null;
  }, []);
  useEffect(() => stop, [stop]);

  const verify = useCallback(
    (job: GradeJob) => {
      stop();
      const w = createWorker();
      worker.current = w;
      w.onmessage = ({ data }) => {
        stop();
        setState(
          data.type === 'graded' ? { ...data, status: 'done' } : { status: 'error', message: data.message },
        );
      };
      w.onerror = (event) => {
        stop();
        setState({ status: 'error', message: event.message || 'grade worker failed to start' });
      };
      setState({ status: 'grading' });
      w.postMessage(job);
    },
    [createWorker, stop],
  );

  const clear = useCallback(() => {
    stop();
    setState({ status: 'idle' });
  }, [stop]);

  return { state, verify, clear };
}
