import type {
  Damage,
  Fault,
  FindingView,
  Frame,
  HotFrame,
  InputLog,
  SceneInfo,
  WorkerToMain,
} from './protocol.js';
import { PinCapture } from './capture.js';
import { SharedSnapshotReader, unpackSnapshot, type SnapshotData } from './snapshot-channel.js';
import { SnapshotDecoder } from './snapshot-codec.js';
import { SerialLog } from './serial.js';

/** Serial Monitor keeps this much of the output (characters). */
export const SERIAL_TAIL_CHARS = 8192;

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

  private utf8 = new TextDecoder();
  private decoder = new SnapshotDecoder();
  private reader: SharedSnapshotReader | null = null;
  private hot: HotFrame | null = null;
  private findings: readonly FindingView[] = [];
  private faults: readonly Fault[] = [];
  private damaged: Damage = { parts: [], pins: [] };

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
      case 'error':
        this.error = msg.message;
        return true;
    }
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
export { BENCH_SCENARIOS, MAX_SIM_SECONDS, SAFETY_SCENARIOS, SCENARIOS } from './protocol.js';
// Encoding side, for stand-in workers in UI tests.
export { SnapshotEncoder } from './snapshot-codec.js';
export { PinCapture, type PinTrace } from './capture.js';
export { MAX_PROBE_PINS } from './probe.js';
export { SERIAL_BAUD_RATES, SerialLog, decodeSerial, resample, standardBaud } from './serial.js';
export type { DecodedSerial, SerialLine } from './serial.js';
export { packSnapshot } from './snapshot-channel.js';
export type * from './protocol.js';
// Types only: grading itself runs in a worker (`grade` from the engine entry).
export type { GradeJob, GradeResult, Pose, Trace, TraceSample } from './grade.js';
