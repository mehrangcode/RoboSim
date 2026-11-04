import type {
  Damage,
  EnergyPart,
  EnergySource,
  Fault,
  FindingView,
  Frame,
  HotFrame,
  InputLog,
  MeasureChannel,
  SceneInfo,
  WorkerToMain,
} from './protocol.js';
import { PinCapture } from './capture.js';
import { ScopeBuffer } from './scope.js';
import { SharedSnapshotReader, unpackSnapshot, type SnapshotData } from './snapshot-channel.js';
import { SnapshotDecoder } from './snapshot-codec.js';
import { SerialLog } from './serial.js';

export { batteryLife, type BatteryLife, type BatteryLifeInput } from './battery-life.js';
export type { EnergyPart, EnergySource } from './protocol.js';

/** Serial Monitor keeps this much of the output (characters). */
export const SERIAL_TAIL_CHARS = 8192;
/** The meter display averages the last 100 ms of slices (FR-SIM-13: ≈10 Hz readout). */
export const METER_WINDOW_SLICES = 100;

/** One probe's reading: average, minimum and maximum (NaN when the probe does not resolve). */
export interface ProbeReading {
  readonly avg: number;
  readonly min: number;
  readonly max: number;
}

/** Answer to an `ohms` request. */
export type OhmsAnswer = Extract<WorkerToMain, { type: 'ohms' }>;

/** Power budget of the present run (FR-SIM-15) as the panel reads it. */
export interface EnergyView {
  readonly session: number;
  /** Slice recording started at (> 0: the panel was opened mid-run). */
  readonly fromSlice: number;
  readonly upToSlice: number;
  readonly seconds: number;
  readonly parts: readonly EnergyPart[];
  readonly sources: readonly EnergySource[];
  readonly mcuJoules: number;
  readonly bucketSeconds: number;
  /** Energy per bucket (J) per part id, oldest first. */
  readonly series: ReadonlyMap<string, Float32Array>;
}

interface MeasureBatch {
  readonly slices: number;
  readonly data: Float32Array;
}

/**
 * Main-thread side of the worker protocol (Technical Design §5.8), DOM-free: folds worker messages
 * and shared-buffer snapshots into the {@link Frame} the UI renders.
 *
 * `receive` handles every message; with a shared buffer the owner also calls `poll` once per
 * animation frame. Both return true when the visible state changed.
 */
export class SimClient {
  scene: SceneInfo | null = null;
  frame: Frame | null = null;
  error: string | null = null;
  /** Firmware output decoded as sent (UTF-8, newest {@link SERIAL_TAIL_CHARS}). */
  serial = '';
  /** Raw UART output with slices and baud rates, for the Serial Monitor. */
  serialLog = new SerialLog();
  engineVersion: string | null = null;
  /** Input-log entries being replayed by the current run (0 = live run). */
  replaying = 0;
  /** Called with the input log the worker sent in answer to `exportLog`. */
  onInputLog: ((log: InputLog) => void) | null = null;
  /** Latest logic-analyzer capture (kept across resets until a new one starts). */
  capture: PinCapture | null = null;
  /** Called with the worker's answer to an `ohms` request. */
  onOhms: ((answer: OhmsAnswer) => void) | null = null;

  private utf8 = new TextDecoder();
  private decoder = new SnapshotDecoder();
  private reader: SharedSnapshotReader | null = null;
  private hot: HotFrame | null = null;
  private findings: readonly FindingView[] = [];
  private faults: readonly Fault[] = [];
  private damaged: Damage = { parts: [], pins: [] };
  /** Recent measurement batches per channel (newest last) of the latest subscription. */
  private measures = new Map<MeasureChannel, { session: number; batches: MeasureBatch[] }>();
  private scopeSession = -1;
  /** Oscilloscope samples of the latest scope subscription (FR-SIM-14), or null before the first. */
  scope: ScopeBuffer | null = null;
  /** Power budget of the present run (FR-SIM-15), or null before its first report. */
  energy: EnergyView | null = null;

  receive(msg: WorkerToMain): boolean {
    switch (msg.type) {
      case 'loaded':
        this.scene = msg.scene;
        this.engineVersion = msg.engineVersion;
        this.replaying = msg.replaying;
        this.error = null;
        this.serial = '';
        this.serialLog = new SerialLog();
        this.utf8 = new TextDecoder();
        this.decoder = new SnapshotDecoder();
        this.reader = null;
        this.hot = null;
        this.frame = null;
        this.findings = [];
        this.faults = [];
        this.damaged = { parts: [], pins: [] };
        this.measures.clear();
        this.scope = null;
        this.energy = null;
        return true;
      case 'channel':
        this.reader = new SharedSnapshotReader(msg.buffer);
        return this.poll();
      case 'snapshot':
        return this.decode(unpackSnapshot(msg.buffer));
      case 'dict':
        this.decoder.apply(msg.delta);
        return false;
      case 'serial':
        for (const c of msg.chunks) this.serial += this.utf8.decode(c.bytes, { stream: true });
        this.serial = this.serial.slice(-SERIAL_TAIL_CHARS);
        this.serialLog.append(msg.chunks);
        return true;
      case 'findings':
        this.findings = msg.findings;
        return this.merge();
      case 'faults':
        this.faults = msg.faults;
        return this.merge();
      case 'damaged':
        this.damaged = msg.damaged;
        return this.merge();
      case 'inputLog':
        this.onInputLog?.(msg.log);
        return false;
      case 'edges':
        if (msg.start) this.capture = new PinCapture(msg.capture, msg.start);
        if (this.capture?.id !== msg.capture || this.capture.stopped) return false;
        this.capture.append(msg.data, msg.until, msg.full === true);
        return true;
      case 'energy':
        return this.foldEnergy(msg);
      case 'scopeFine':
        if (msg.session !== this.scopeSession || !this.scope) return false;
        this.scope.appendFine(msg.reactive, msg.data);
        return true;
      case 'measures': {
        if (msg.channel === 'scope') return this.foldScope(msg);
        const prev = this.measures.get(msg.channel);
        if (prev && msg.session < prev.session) return false; // answers a superseded subscription
        const batches = prev?.session === msg.session ? prev.batches : [];
        // A paused sample (0 slices) stands alone; a run's batches form the rolling window.
        if (msg.slices === 0) batches.splice(0, batches.length, { slices: 0, data: msg.data });
        else {
          if (batches[0]?.slices === 0) batches.length = 0;
          batches.push({ slices: msg.slices, data: msg.data });
          let total = batches.reduce((n, b) => n + b.slices, 0);
          while (batches.length > 1 && total - (batches[0]?.slices ?? 0) >= METER_WINDOW_SLICES)
            total -= batches.shift()?.slices ?? 0;
        }
        this.measures.set(msg.channel, { session: msg.session, batches });
        return true;
      }
      case 'ohms':
        this.onOhms?.(msg);
        return false;
      case 'error':
        this.error = msg.message;
        return true;
    }
  }

  /**
   * Readings of `channel` over the rolling window (≈ the last 100 slices), one per probe in subscription
   * order; null before the first batch.
   */
  readings(channel: MeasureChannel): ProbeReading[] | null {
    const batches = this.measures.get(channel)?.batches;
    const first = batches?.[0];
    if (!batches || !first) return null;
    const probes = first.data.length / 3;
    const out: ProbeReading[] = [];
    for (let i = 0; i < probes; i++) {
      let weighted = 0;
      let weight = 0;
      let min = Infinity;
      let max = -Infinity;
      for (const b of batches) {
        const w = Math.max(1, b.slices);
        weighted += w * (b.data[3 * i] ?? NaN);
        weight += w;
        min = Math.min(min, b.data[3 * i + 1] ?? NaN);
        max = Math.max(max, b.data[3 * i + 2] ?? NaN);
      }
      out.push({ avg: weighted / weight, min, max });
    }
    return out;
  }

  private foldEnergy(msg: Extract<WorkerToMain, { type: 'energy' }>): boolean {
    const prev = this.energy;
    if (prev && msg.session < prev.session) return false; // a replaced run
    const same = prev?.session === msg.session;
    const count = msg.parts.length ? msg.buckets.length / msg.parts.length : 0;
    const series = new Map<string, Float32Array>();
    msg.parts.forEach((part, k) => {
      const old = same ? prev.series.get(part.id) : undefined;
      const keep = old ? old.subarray(0, Math.min(msg.bucketFrom, old.length)) : new Float32Array(0);
      const next = new Float32Array(keep.length + count);
      next.set(keep);
      next.set(msg.buckets.subarray(k * count, (k + 1) * count), keep.length);
      series.set(part.id, next);
    });
    const { type: _type, buckets: _buckets, bucketFrom: _from, ...rest } = msg;
    this.energy = { ...rest, series };
    return true;
  }

  private foldScope(msg: Extract<WorkerToMain, { type: 'measures' }>): boolean {
    if (msg.session < this.scopeSession) return false; // answers a superseded subscription
    // A paused sample (0 slices) carries no history; it only tells how many channels there are.
    const channels = msg.data.length / 3 / Math.max(1, msg.slices);
    if (!this.scope || msg.session !== this.scopeSession || this.scope.channels !== channels) {
      this.scope = new ScopeBuffer(channels, msg.unresolved ?? []);
      this.scopeSession = msg.session;
    }
    this.scope.append(msg.fromSlice, msg.slices, msg.data, msg.pwm);
    return true;
  }

  /** Reads the shared buffer; true when a new snapshot arrived. */
  poll(): boolean {
    const data = this.reader?.read();
    return data ? this.decode(data) : false;
  }

  /** Freezes the current capture; edges still in flight for it are dropped. */
  stopCapture(): void {
    if (this.capture) this.capture.stopped = true;
  }

  clearCapture(): void {
    this.capture = null;
  }

  private decode(data: SnapshotData): boolean {
    this.hot = this.decoder.decode(data.count, data.values, data.tags) as unknown as HotFrame;
    return this.merge();
  }

  private merge(): boolean {
    if (!this.hot) return false;
    this.frame = { ...this.hot, faults: this.faults, findings: this.findings, damaged: this.damaged };
    return true;
  }
}

// Main-thread entry (`@robosim/sim-runtime/client`): the protocol without the engine behind it.
export {
  BENCH_SCENARIOS,
  MAX_METER_PROBES,
  MAX_SCOPE_CHANNELS,
  MAX_FINE_PER_SLICE,
  MAX_SIM_SECONDS,
  SAFETY_SCENARIOS,
  SCENARIOS,
} from './protocol.js';
// Encoding side, for stand-in workers in UI tests.
export { SnapshotEncoder } from './snapshot-codec.js';
export { PinCapture, type PinTrace } from './capture.js';
export {
  SCOPE_BUFFER_SLICES,
  SCOPE_FINE_MAX_POINTS,
  SCOPE_FINE_SECONDS,
  ScopeBuffer,
  type FineTrace,
  type ScopePwm,
} from './scope.js';
export { MAX_PROBE_PINS } from './probe.js';
export { SERIAL_BAUD_RATES, SerialLog, decodeSerial, resample, standardBaud } from './serial.js';
export type { DecodedSerial, SerialLine } from './serial.js';
export { packSnapshot } from './snapshot-channel.js';
export type * from './protocol.js';
// Types only: grading itself runs in a worker (`grade` from the engine entry).
export type { GradeJob, GradeResult, Pose, Trace, TraceSample } from './grade.js';
