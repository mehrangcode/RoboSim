import { SimClient, type InputLog, type MainToWorker, type WorkerToMain } from '@robosim/sim-runtime/client';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

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

/**
 * Owns one simulation worker for the lifetime of the component. Events arrive as messages; with a
 * shared snapshot buffer the hook also polls it once per animation frame (Technical Design §5.8).
 */
export function useSimulation(createWorker: () => WorkerLike = createSimWorker) {
  const worker = useRef<WorkerLike | null>(null);
  const [client] = useState(() => new SimClient());
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    const w = createWorker();
    w.onmessage = (event) => {
      if (client.receive(event.data)) rerender();
    };
    // Uncaught exceptions and module-load failures inside the worker surface here, not in onmessage.
    w.onerror = (event) => {
      client.error = event.message || 'worker failed to start';
      rerender();
    };
    worker.current = w;
    let raf = 0;
    const poll = () => {
      if (client.poll()) rerender();
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => {
      cancelAnimationFrame(raf);
      w.terminate();
      worker.current = null;
    };
  }, [createWorker, client]);

  const send = useCallback((message: MainToWorker) => worker.current?.postMessage(message), []);

  /** Asks the worker for the input log of the current run. */
  const exportLog = useCallback(
    () =>
      new Promise<InputLog>((resolve) => {
        client.onInputLog = (log) => {
          client.onInputLog = null;
          resolve(log);
        };
        send({ type: 'exportLog' });
      }),
    [client, send],
  );

  return {
    scene: client.scene,
    frame: client.frame,
    error: client.error,
    serial: client.serial,
    replaying: client.replaying,
    send,
    exportLog,
  };
}
