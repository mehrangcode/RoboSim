import { ENGINE_VERSION } from './engine-version.js';
import { HeadlessRun } from './input-log.js';
import {
  MAX_SIM_SECONDS,
  type ChallengeView,
  type Damage,
  type FindingView,
  type InputLog,
  type PinView,
} from './protocol.js';
import { findingView } from './scenarios.js';
import { challengeView, damageView, pinViews, robotView } from './views.js';

export { MAX_SIM_SECONDS };
/** Trace sample interval: 100 slices = 10 Hz (Technical Design §11.1). */
export const TRACE_INTERVAL_SLICES = 100;

/**
 * A verified run (Technical Design §11.1): a self-contained input log (project, firmware, seed,
 * inputs, engine version) and the simulated-time cap. Resolving stored ids into the log is the
 * learning module's job (P3).
 */
export interface GradeJob {
  readonly log: InputLog;
  readonly maxSimSeconds: number;
}

/** Robot pose `[x m, y m, heading rad]`. */
export type Pose = readonly [number, number, number];

export interface TraceSample {
  readonly slice: number;
  readonly robot?: Pose;
  readonly pins: Readonly<Record<string, PinView>>;
  /** Component states (`ComponentModel.snapshot()`), parts without state omitted. */
  readonly parts: Readonly<Record<string, unknown>>;
}

/**
 * What the run did, sampled at 10 Hz plus the final slice; serial output and runtime findings are
 * stamped with the slice they happened in. Plain JSON: numbers round-trip exactly, so two traces
 * are bit-identical exactly when their JSON is equal.
 */
export interface Trace {
  readonly intervalSlices: number;
  readonly samples: readonly TraceSample[];
  readonly serial: readonly { readonly slice: number; readonly text: string }[];
  readonly findings: readonly (FindingView & { readonly slice: number })[];
}

export interface GradeResult {
  readonly engineVersion: string;
  readonly seed: number;
  /** The challenge's decision, or `unresolved` when the time cap came first (or there is none). */
  readonly outcome: 'success' | 'failure' | 'unresolved';
  readonly endSlice: number;
  readonly challenge: ChallengeView | null;
  readonly score: { readonly total: number; readonly max: number } | null;
  readonly staticFindings: readonly FindingView[];
  readonly damaged: Damage;
  /** State at `endSlice`, comparable with a live frame paused at the same slice. */
  readonly final: TraceSample;
  /** All UART output of the run. */
  readonly serial: string;
  readonly trace: Trace;
}

export class EngineVersionMismatchError extends Error {
  constructor(
    readonly requested: string,
    readonly actual: string,
  ) {
    super(`Job needs engine ${requested}, this grader runs ${actual}`);
    this.name = 'EngineVersionMismatchError';
  }
}

/**
 * Runs a job headless and unpaced until the challenge decides or `maxSimSeconds` is reached —
 * slice by slice, stopping on the decisive slice exactly as the live pacer does (`stopWhen`).
 * DOM- and Node-free: the grader service and the Lab's verify worker share it.
 */
export function grade(job: GradeJob): GradeResult {
  const { log, maxSimSeconds } = job;
  if (log.engineVersion !== ENGINE_VERSION)
    throw new EngineVersionMismatchError(log.engineVersion, ENGINE_VERSION);
  if (!(maxSimSeconds > 0 && maxSimSeconds <= MAX_SIM_SECONDS))
    throw new RangeError(`maxSimSeconds must be in (0, ${MAX_SIM_SECONDS}], got ${maxSimSeconds}`);
  const maxSlices = Math.round(maxSimSeconds * 1000);

  // Built-in ids are display hints only: the grader runs the document and firmware it was given.
  const run = new HeadlessRun({ project: log.project, firmware: log.firmware }, log.seed, log.entries);
  const s = run.scenario;
  const sim = s.circuit.sim;

  const serial: { slice: number; text: string }[] = [];
  let pendingSerial = '';
  const utf8 = new TextDecoder();
  sim.mcu?.uart(0).onData((bytes) => {
    pendingSerial += utf8.decode(bytes, { stream: true });
  });

  const sample = (): TraceSample => {
    const parts: Record<string, unknown> = {};
    for (const c of sim.snapshot().components) if (c.state !== null) parts[c.id] = c.state;
    const r = s.world ? robotView(s) : null;
    return {
      slice: sim.slice,
      ...(r ? { robot: [r.x, r.y, r.angle] as const } : {}),
      pins: pinViews(s),
      parts,
    };
  };

  const samples: TraceSample[] = [sample()];
  const findings: (FindingView & { slice: number })[] = [];
  const challenge = s.challenge;
  while (sim.slice < maxSlices && !challenge?.isDecided) {
    run.runTo(sim.slice + 1);
    if (pendingSerial) {
      serial.push({ slice: sim.slice, text: pendingSerial });
      pendingSerial = '';
    }
    const latched = s.safety.findings();
    for (let i = findings.length; i < latched.length; i++) {
      const f = latched[i];
      if (f) findings.push({ slice: sim.slice, ...findingView(f) });
    }
    if (sim.slice % TRACE_INTERVAL_SLICES === 0) samples.push(sample());
  }
  const final = samples.at(-1)?.slice === sim.slice ? (samples.at(-1) as TraceSample) : sample();
  if (final !== samples.at(-1)) samples.push(final);

  const view = challenge ? challengeView(challenge.result(), s.arena) : null;
  return {
    engineVersion: ENGINE_VERSION,
    seed: log.seed,
    outcome: view && view.status !== 'running' ? view.status : 'unresolved',
    endSlice: sim.slice,
    challenge: view,
    score: view?.score ? { total: view.score.total, max: view.score.max } : null,
    staticFindings: s.scene.staticFindings,
    damaged: damageView(s),
    final,
    serial: serial.map((c) => c.text).join(''),
    trace: { intervalSlices: TRACE_INTERVAL_SLICES, samples, serial, findings },
  };
}

/** SHA-256 (hex) of the trace's JSON: equal digests ⇔ bit-identical runs. */
export async function traceDigest(trace: Trace): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(trace));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('');
}
