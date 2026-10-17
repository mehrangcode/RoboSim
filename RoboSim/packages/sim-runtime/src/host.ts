import { Pacer } from '@robosim/sim-core';
import type { ProjectDocument } from '@robosim/shared';
import { ENGINE_VERSION } from './engine-version.js';
import { InputLogger, type LiveInput } from './input-log.js';
import type {
  Damage,
  FirmwarePayload,
  RunSource,
  Fault,
  HotFrame,
  InputLogEntry,
  MainToWorker,
  ScenarioId,
  WorkerToMain,
} from './protocol.js';
import { buildRun, findingView, resolveSource, type Scenario } from './scenarios.js';
import { SharedSnapshotWriter, packSnapshot } from './snapshot-channel.js';
import { SnapshotEncoder } from './snapshot-codec.js';
import { ALL_MCU_PINS, challengeView, damageView, obstacleViews, pinViews, robotView } from './views.js';

/** Snapshots to the UI at most this often (wall ms); the simulation itself is unaffected. */
const FRAME_INTERVAL_MS = 33;

export interface SimHostOptions {
  /** Publish snapshots through a shared buffer (needs cross-origin isolation); else transfer them. */
  readonly shared?: boolean;
}

interface Run {
  /** What was loaded, resolved to document + firmware (built-ins keep their id). */
  readonly source: {
    readonly scenario: ScenarioId | null;
    readonly project: ProjectDocument;
    readonly firmware: FirmwarePayload;
  };
  readonly seed: number;
  readonly scenario: Scenario;
  readonly pacer: Pacer;
  readonly logger: InputLogger;
  readonly encoder: SnapshotEncoder;
  writer: SharedSnapshotWriter | null;
  /** Serial bytes not yet posted, grouped by slice and baud. */
  serialOut: { slice: number; baud: number; bytes: number[] }[];
  /** Last event payloads sent, to post only changes. */
  sentFindings: number;
  sentFaults: string;
  sentDamage: string;
}

/**
 * Worker-side driver (Technical Design §5.8): owns the run, paces it against wall-clock time,
 * records the input log and publishes binary snapshots plus events. DOM-free (the worker injects
 * `post` and `now`), so it also runs under Node tests.
 */
export class SimHost {
  private run: Run | null = null;
  private running = false;
  private speed = 1;
  private seq = 0;
  private lastFrameWall = -Infinity;
  private lastFrameSim = 0;
  private readonly shared: boolean;

  constructor(
    private readonly post: (msg: WorkerToMain, transfer?: ArrayBuffer[]) => void,
    private readonly now: () => number,
    options: SimHostOptions = {},
  ) {
    this.shared = options.shared ?? false;
  }

  handle(msg: MainToWorker): void {
    this.guard(() => {
      switch (msg.type) {
        case 'load':
          this.load(
            'scenario' in msg
              ? { scenario: msg.scenario }
              : 'template' in msg
                ? { template: msg.template, files: msg.files, firmware: msg.firmware }
                : { project: msg.project, firmware: msg.firmware },
            msg.seed ?? 1,
            msg.inputLog ?? [],
          );
          break;
        case 'control':
          this.control(msg.action);
          break;
        case 'speed':
          this.speed = msg.value;
          this.run?.pacer.setSpeed(msg.value);
          break;
        case 'input':
          this.input({ kind: 'component', componentId: msg.componentId, name: msg.name, value: msg.value });
          break;
        case 'serial':
          this.input({ kind: 'serial', text: msg.text });
          break;
        case 'exportLog':
          if (this.run)
            this.post({
              type: 'inputLog',
              log: {
                engineVersion: ENGINE_VERSION,
                ...this.run.source,
                seed: this.run.seed,
                entries: [...this.run.logger.entries],
                endSlice: this.run.scenario.circuit.sim.slice,
              },
            });
          break;
      }
    });
  }

  /** Called by the worker loop (~every 16 ms). */
  tick(): void {
    this.guard(() => {
      const run = this.run;
      if (run && this.running) {
        run.pacer.tick();
        // The pacer stops on the decisive slice (stopWhen); mirror that as a paused run.
        if (run.scenario.challenge?.isDecided) {
          this.running = false;
          this.publish(true);
          return;
        }
      }
      this.publish(false);
    });
  }

  private guard(fn: () => void): void {
    try {
      fn();
    } catch (e) {
      this.running = false;
      this.run?.pacer.pause();
      this.post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  private input(input: LiveInput): void {
    if (!this.run) return;
    this.run.logger.live(input);
    if (!this.running) this.publish(true);
  }

  private load(source: RunSource, seed: number, replay: readonly InputLogEntry[]): void {
    this.run = null;
    this.running = false;
    const scenario = buildRun(source, seed);
    const logger = new InputLogger(scenario, replay);
    scenario.circuit.sim.addObserver(logger); // last: replayed inputs land where live ones did
    const challenge = scenario.challenge;
    const pacer = new Pacer(scenario.circuit.sim, {
      now: this.now,
      speed: this.speed,
      ...(challenge ? { stopWhen: () => challenge.isDecided } : {}),
    });
    const run: Run = {
      source: resolveSource(source),
      seed,
      scenario,
      pacer,
      logger,
      encoder: new SnapshotEncoder(),
      writer: null,
      serialOut: [],
      sentFindings: 0,
      sentFaults: '[]',
      sentDamage: JSON.stringify(NO_DAMAGE),
    };
    const uart = scenario.scene.serial ? scenario.circuit.sim.mcu?.uart(0) : undefined;
    uart?.onData((bytes) => {
      const slice = scenario.circuit.sim.slice;
      const baud = uart.baud();
      const last = run.serialOut.at(-1);
      if (last?.slice === slice && last.baud === baud) last.bytes.push(...bytes);
      else run.serialOut.push({ slice, baud, bytes: [...bytes] });
    });
    this.run = run;
    this.lastFrameSim = 0;
    this.post({
      type: 'loaded',
      scene: scenario.scene,
      seed,
      engineVersion: ENGINE_VERSION,
      replaying: replay.length,
    });
    this.publish(true);
  }

  private control(action: 'run' | 'pause' | 'reset' | 'step'): void {
    const run = this.run;
    if (!run) return;
    if (action === 'reset') {
      // Reset starts a fresh live run; replaying a log is an explicit `load`.
      const { scenario, project, firmware } = run.source;
      this.load(scenario ? { scenario } : { project, firmware }, run.seed, []);
      return;
    }
    if (action === 'run') {
      this.running = true;
      run.pacer.start();
    } else if (action === 'pause') {
      this.running = false;
      run.pacer.pause();
    } else {
      run.scenario.circuit.sim.run(10);
    }
    this.publish(true);
  }

  private publish(force: boolean): void {
    const run = this.run;
    if (!run) return;
    const wall = this.now();
    if (!force && wall - this.lastFrameWall < FRAME_INTERVAL_MS) return;
    const s = run.scenario;
    const sim = s.circuit.sim;
    const snap = sim.snapshot();
    const dtWall = (wall - this.lastFrameWall) / 1000;
    const rtf =
      this.running && Number.isFinite(dtWall) && dtWall > 0 ? (snap.simTime - this.lastFrameSim) / dtWall : 0;
    this.lastFrameWall = wall;
    this.lastFrameSim = snap.simTime;

    // Events first: the UI merges them into the frame built from the snapshot that follows.
    if (run.serialOut.length) {
      const chunks = run.serialOut.map((c) => ({
        slice: c.slice,
        baud: c.baud,
        bytes: Uint8Array.from(c.bytes),
      }));
      run.serialOut = [];
      this.post(
        { type: 'serial', chunks },
        chunks.map((c) => c.bytes.buffer),
      );
    }
    const findings = s.safety.findings();
    if (findings.length !== run.sentFindings) {
      run.sentFindings = findings.length;
      this.post({ type: 'findings', findings: findings.map(findingView) });
    }
    const faults: Fault[] = snap.faults.map((f) => ({ code: f.code, componentId: f.componentId }));
    const faultsKey = JSON.stringify(faults);
    if (faultsKey !== run.sentFaults) {
      run.sentFaults = faultsKey;
      this.post({ type: 'faults', faults });
    }
    const damaged = damageView(s);
    const damageKey = JSON.stringify(damaged);
    if (damageKey !== run.sentDamage) {
      run.sentDamage = damageKey;
      this.post({ type: 'damaged', damaged });
    }

    const parts: Record<string, unknown> = {};
    for (const c of snap.components) if (c.state !== null) parts[c.id] = c.state;
    const hot: HotFrame = {
      seq: ++this.seq,
      simTime: snap.simTime,
      rtf,
      running: this.running,
      parts,
      pins: pinViews(s, ALL_MCU_PINS),
      ...(s.world ? { robot: robotView(s) } : {}),
      ...(s.world && s.arena?.obstacles?.some((o) => o.dynamic) ? { obstacles: obstacleViews(s) } : {}),
      ...(s.challenge ? { challenge: challengeView(s.challenge.result(), s.arena) } : {}),
    };
    const encoded = run.encoder.encode(hot);
    if (encoded.delta) this.post({ type: 'dict', delta: encoded.delta });
    if (this.shared) {
      if (!run.writer || encoded.count > run.writer.capacity) {
        run.writer = new SharedSnapshotWriter(Math.max(256, encoded.count * 2));
        this.post({ type: 'channel', buffer: run.writer.buffer });
      }
      run.writer.write(encoded.count, encoded.values, encoded.tags);
    } else {
      const buffer = packSnapshot(encoded.count, encoded.values, encoded.tags);
      this.post({ type: 'snapshot', buffer }, [buffer]);
    }
  }
}

const NO_DAMAGE: Damage = { parts: [], pins: [] };
