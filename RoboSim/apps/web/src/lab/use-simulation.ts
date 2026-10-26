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

/** A running simulation that delivers no new frame for this long is reported as not responding. */
export const STALL_MS = 5000;
/** A longer gap between animation frames means the tab was hidden or throttled, not a stalled worker. */
const HIDDEN_GAP_MS = 1000;

/**
 * Owns one simulation worker for the lifetime of the component. Events arrive as messages; with a
 * shared snapshot buffer the hook also polls it once per animation frame (Technical Design §5.8).
 * A worker that dies or stops answering is reported (`error`, `stalled`); `restart` replaces it.
 */
export function useSimulation(createWorker: () => WorkerLike = createSimWorker) {
  const worker = useRef<WorkerLike | null>(null);
  const [client, setClient] = useState(() => new SimClient());
  const [stalled, setStalled] = useState(false);
  /** Pins the logic analyzer is recording (null = not recording). */
  const [probing, setProbing] = useState<readonly string[] | null>(null);
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
    let lastSeq = -1;
    let lastProgress = performance.now();
    let lastTick = lastProgress;
    let reported = false;
    const poll = (now: number) => {
      if (client.poll()) rerender();
      const frame = client.frame;
      if (now - lastTick > HIDDEN_GAP_MS || !frame?.running || frame.seq !== lastSeq) {
        lastProgress = now;
        lastSeq = frame?.seq ?? -1;
        if (reported) setStalled((reported = false));
      } else if (!reported && client.error === null && now - lastProgress > STALL_MS) {
        setStalled((reported = true));
      }
      lastTick = now;
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => {
      cancelAnimationFrame(raf);
      w.terminate();
      worker.current = null;
    };
  }, [createWorker, client]);

  /** Replaces the worker (and its state) with a fresh one; the caller loads a run again. */
  const restart = useCallback(() => {
    setStalled(false);
    setProbing(null);
    setClient(new SimClient());
  }, []);

  // A new identity per worker: effects that load or configure a run re-run for a restarted worker.
  const send = useCallback(
    (message: MainToWorker) => worker.current?.postMessage(message),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- client marks the worker generation
    [client],
  );

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

  const clearSerial = useCallback(() => {
    client.serialLog.clear();
    rerender();
  }, [client]);

  /** Logic analyzer: record these pins from now on (also across resets), or stop with null. */
  const probe = useCallback(
    (pins: readonly string[] | null) => {
      if (pins === null) client.stopCapture();
      send({ type: 'probe', pins });
      setProbing(pins?.length ? pins : null);
    },
    [client, send],
  );

  const clearCapture = useCallback(() => {
    client.clearCapture();
    rerender();
  }, [client]);

  return {
    scene: client.scene,
    frame: client.frame,
    error: client.error,
    stalled,
    restart,
    serial: client.serial,
    serialLog: client.serialLog,
    clearSerial,
    capture: client.capture,
    probing,
    probe,
    clearCapture,
    replaying: client.replaying,
    send,
    exportLog,
  };
}
