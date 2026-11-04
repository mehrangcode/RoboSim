import {
  SimClient,
  type InputLog,
  type MainToWorker,
  type MeasureChannel,
  type MeasureProbe,
  type OhmsAnswer,
  type PointRef,
  type WorkerToMain,
} from '@robosim/sim-runtime/client';
import type { ProjectDocument } from '@robosim/shared';
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

  /** Measurement channel (FR-SIM-13): subscribe `channel` to these probes (also across resets), or stop. */
  const measure = useCallback(
    (channel: MeasureChannel, probes: readonly MeasureProbe[] | null) =>
      send({ type: 'measure', channel, probes: probes?.length ? probes : null }),
    [send],
  );

  /** Power budget recording (TD §18.4): while the power panel is open or "record every run" is set. */
  const energyOn = useCallback((on: boolean) => send({ type: 'energy', on }), [send]);

  /** Oscilloscope fine mode (TD §18.3): sub-step samples of reactive circuits while on. */
  const scopeFine = useCallback((on: boolean) => send({ type: 'scopeFine', on }), [send]);

  /**
   * Resistance between two points: of the loaded run while it is not running, or of `project` (the
   * circuit being edited). Answers arrive in request order; a superseded answer still resolves.
   */
  const ohmsPending = useRef(new Map<number, (answer: OhmsAnswer) => void>());
  const ohmsId = useRef(0);
  const ohms = useCallback(
    (red: PointRef, black: PointRef | null, project?: ProjectDocument) =>
      new Promise<OhmsAnswer>((resolve) => {
        const id = ++ohmsId.current;
        const pending = ohmsPending.current;
        pending.set(id, resolve);
        client.onOhms = (answer) => {
          pending.get(answer.id)?.(answer);
          pending.delete(answer.id);
        };
        send({ type: 'ohms', id, red, black, ...(project ? { project } : {}) });
      }),
    [client, send],
  );

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
    measure,
    scopeFine,
    energyOn,
    /** Power budget of the present run (FR-SIM-15), null before its first report. */
    energy: client.energy,
    ohms,
    meterReadings: client.readings('meter'),
    /** Oscilloscope samples (mutated in place; `scopeVersion` changes with every batch). */
    scope: client.scope,
    scopeVersion: client.scope?.version ?? 0,
    replaying: client.replaying,
    send,
    exportLog,
  };
}
