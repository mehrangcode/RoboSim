import type { Frame, MainToWorker, SceneInfo, WorkerToMain } from '@robosim/sim-runtime';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface WorkerLike {
  postMessage(message: MainToWorker): void;
  onmessage: ((event: MessageEvent<WorkerToMain>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  terminate(): void;
}

export const createSimWorker = (): WorkerLike =>
  new Worker(new URL('./sim.worker.ts', import.meta.url), {
    type: 'module',
    name: 'robosim-sim',
  }) as unknown as WorkerLike;

/** Owns one simulation worker for the lifetime of the component. */
export function useSimulation(createWorker: () => WorkerLike = createSimWorker) {
  const worker = useRef<WorkerLike | null>(null);
  const [scene, setScene] = useState<SceneInfo | null>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const w = createWorker();
    w.onmessage = (event) => {
      const msg = event.data;
      if (msg.type === 'loaded') {
        setScene(msg.scene);
        setError(null);
      } else if (msg.type === 'frame') setFrame(msg.frame);
      else setError(msg.message);
    };
    // Uncaught exceptions and module-load failures inside the worker surface here, not in onmessage.
    w.onerror = (event) => setError(event.message || 'worker failed to start');
    worker.current = w;
    return () => {
      w.terminate();
      worker.current = null;
    };
  }, [createWorker]);

  const send = useCallback((message: MainToWorker) => worker.current?.postMessage(message), []);
  return { scene, frame, error, send };
}
