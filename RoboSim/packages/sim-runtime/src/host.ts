import { Pacer, ohmmeterInstance, type NetId } from '@robosim/sim-core';
import type { ProjectDocument } from '@robosim/shared';
import type { Level } from '@robosim/sim-core';
import { ENGINE_VERSION } from './engine-version.js';
import { InputLogger, type LiveInput } from './input-log.js';
import { MeasureHub, ScopeRecorder, resolvePoint } from './measure.js';
import { MAX_METER_PROBES, MAX_SCOPE_CHANNELS } from './protocol.js';
import type {
  Damage,
  FirmwarePayload,
  MeasureChannel,
  MeasureProbe,
  OhmsRefusal,
  PointRef,
  RunSource,
  Fault,
  HotFrame,
  InputLogEntry,
  MainToWorker,
  ProbeStart,
  ScenarioId,
  WorkerToMain,
} from './protocol.js';
import { MAX_PROBE_PINS, PinRecorder } from './probe.js';
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
  /** Logic-analyzer capture of this run, with the start message not yet posted. */
  probe: { id: number; recorder: PinRecorder; start: ProbeStart | null; until: number; done: boolean } | null;
  /** Measurement channel (ADR-026): one view-only observer for every instrument. */
  readonly measure: MeasureHub;
  /** Ohmmeter on a fresh static instance, for one (input-log length, damage) state. */
  ohmmeter: { key: string; read: (a: NetId, b: NetId) => number | null } | null;
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
  /** Pins the logic analyzer records; kept across resets and loads. */
  private probePins: readonly string[] | null = null;
  private captures = 0;
  /** Instrument probes per measurement channel; kept across resets and loads like `probePins`. */
  private readonly measureProbes = new Map<MeasureChannel, readonly MeasureProbe[]>();
  /** Subscription counter: a `measures` message names the subscription it answers. */
  private measureSession = 0;
  /** Scope fine mode (TD §18.3); kept across resets and loads like the probes. */
  private scopeFine = false;
  /** Ohmmeter of the document last measured without a run. */
  private staticOhms: {
    key: string;
    scenario: Scenario;
    read: (a: NetId, b: NetId) => number | null;
  } | null = null;

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
        case 'probe':
          this.probePins = msg.pins?.length ? msg.pins.slice(0, MAX_PROBE_PINS) : null;
          if (this.run) this.startProbe(this.run);
          this.publish(true);
          break;
        case 'measure':
          if (msg.probes?.length)
            this.measureProbes.set(
              msg.channel,
              msg.probes.slice(0, msg.channel === 'scope' ? MAX_SCOPE_CHANNELS : MAX_METER_PROBES),
            );
          else this.measureProbes.delete(msg.channel);
          this.measureSession++;
          this.run?.measure.set(msg.channel, this.measureProbes.get(msg.channel) ?? null);
          this.publish(true);
          break;
        case 'scopeFine':
          this.scopeFine = msg.on;
          this.run?.measure.setFine(msg.on);
          this.publish(true);
          break;
        case 'ohms': {
          // Always answered, so the meter never waits forever; a failure is also reported as `error`.
          let result: OhmsResult;
          try {
            result = msg.project
              ? this.projectOhms(msg.project, msg.red, msg.black)
              : this.ohms(msg.red, msg.black);
          } catch (e) {
            result = { ohms: null, reason: 'not-loaded' };
            this.post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
          }
          this.post({ type: 'ohms', id: msg.id, ...result });
          break;
        }
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
    this.run?.probe?.recorder.stop();
    this.run = null;
    this.running = false;
    const scenario = buildRun(source, seed);
    const logger = new InputLogger(scenario, replay);
    // Instruments observe before the logger, which must stay last: replayed inputs land where live ones did.
    const measure = new MeasureHub(scenario);
    measure.setFine(this.scopeFine);
    for (const [channel, probes] of this.measureProbes) measure.set(channel, probes);
    scenario.circuit.sim.addObserver(measure);
    scenario.circuit.sim.addObserver(logger);
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
      probe: null,
      measure,
      ohmmeter: null,
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
    this.startProbe(run);
    this.publish(true);
  }

  /**
   * Resistance between two points (FR-SIM-13 Ω mode). Refused while running; measured on a fresh
   * static instance with the run's present inputs and damage, never on the live simulation (ADR-026).
   */
  private ohms(red: PointRef, black: PointRef | null): OhmsResult {
    const run = this.run;
    if (!run) return { ohms: null, reason: 'not-loaded' };
    if (this.running) return { ohms: null, reason: 'running' };
    const a = resolvePoint(run.scenario, red);
    const b = black ? resolvePoint(run.scenario, black) : { net: 0 };
    if (!a || !b) return { ohms: null, reason: 'unresolved' };
    const sim = run.scenario.circuit.sim;
    const applied = run.logger.entries.filter((e) => e.slice <= sim.slice);
    const damaged = damageView(run.scenario).parts;
    const key = `${applied.length}|${damaged.join(',')}`;
    if (run.ohmmeter?.key !== key) {
      const latest = new Map<string, { componentId: string; name: string; value: number | boolean }>();
      for (const c of run.source.project.components)
        for (const [name, value] of Object.entries(c.inputs ?? {}))
          latest.set(`${c.id}\u0000${name}`, { componentId: c.id, name, value });
      for (const e of applied)
        if (e.kind === 'component')
          latest.set(`${e.componentId}\u0000${e.name}`, {
            componentId: e.componentId,
            name: e.name,
            value: e.value,
          });
      run.ohmmeter = {
        key,
        read: ohmmeterInstance(run.scenario.circuit.assembled, { inputs: [...latest.values()], damaged }),
      };
    }
    const ohms = run.ohmmeter.read(a.net, b.net);
    return ohms === null ? { ohms: null, reason: 'open' } : { ohms };
  }

  /**
   * Ω on the circuit being edited (no run needed: a meter on an unpowered board). The document is
   * loaded without firmware for its netlist only, cached until the document changes.
   */
  private projectOhms(project: ProjectDocument, red: PointRef, black: PointRef | null): OhmsResult {
    const key = JSON.stringify([project.components, project.wires]);
    if (this.staticOhms?.key !== key) {
      let scenario: Scenario;
      try {
        scenario = buildRun({ project, firmware: NO_FIRMWARE }, 1);
      } catch {
        return { ohms: null, reason: 'not-loaded' };
      }
      const inputs = project.components.flatMap((c) =>
        Object.entries(c.inputs ?? {}).map(([name, value]) => ({ componentId: c.id, name, value })),
      );
      this.staticOhms = { key, scenario, read: ohmmeterInstance(scenario.circuit.assembled, { inputs }) };
    }
    const { scenario, read } = this.staticOhms;
    const a = resolvePoint(scenario, red);
    const b = black ? resolvePoint(scenario, black) : { net: 0 };
    if (!a || !b) return { ohms: null, reason: 'unresolved' };
    const ohms = read(a.net, b.net);
    return ohms === null ? { ohms: null, reason: 'open' } : { ohms };
  }

  /** Replaces the run's capture with one of {@link probePins} from the current cycle (or none). */
  private startProbe(run: Run): void {
    run.probe?.recorder.stop();
    run.probe = null;
    const mcu = run.scenario.circuit.sim.mcu;
    const pins = this.probePins?.filter((p) => ALL_MCU_PINS.includes(p));
    if (!mcu || !pins?.length) return;
    const views = pinViews(run.scenario, pins);
    const levels = pins.map((p): Level => (views[p]?.level === 1 ? 1 : 0));
    run.probe = {
      id: ++this.captures,
      recorder: new PinRecorder(mcu, pins, levels),
      start: { pins, cycle: mcu.cycle, clockHz: mcu.clockHz, levels },
      until: -1,
      done: false,
    };
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
    const probe = run.probe;
    const until = sim.mcu?.cycle ?? 0;
    if (probe && !probe.done && (probe.start || until !== probe.until || probe.recorder.isFull)) {
      const data = probe.recorder.drain();
      const full = probe.recorder.isFull;
      probe.done = full;
      probe.until = until;
      this.post(
        {
          type: 'edges',
          capture: probe.id,
          ...(probe.start ? { start: probe.start } : {}),
          data,
          until,
          ...(full ? { full: true as const } : {}),
        },
        [data.buffer as ArrayBuffer],
      );
      probe.start = null;
    }
    for (const [channel, recorder] of run.measure.channels()) {
      if (recorder.pending === 0 && !force) continue;
      const { fromSlice, slices, data, pwm } = recorder.drain(sim);
      this.post(
        {
          type: 'measures',
          channel,
          session: this.measureSession,
          fromSlice,
          slices,
          data,
          ...(recorder.unresolved.length ? { unresolved: recorder.unresolved } : {}),
          ...(pwm ? { pwm } : {}),
        },
        pwm ? [data.buffer as ArrayBuffer, pwm.buffer as ArrayBuffer] : [data.buffer as ArrayBuffer],
      );
      const fine = recorder instanceof ScopeRecorder ? recorder.drainFine(sim) : null;
      if (fine)
        this.post(
          { type: 'scopeFine', session: this.measureSession, reactive: fine.reactive, data: fine.data },
          [fine.data.buffer as ArrayBuffer],
        );
    }
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
/** An empty program: the ohmmeter needs the netlist only (MCU pins are high-Z anyway). */
const NO_FIRMWARE: FirmwarePayload = { format: 'ihex', text: ':00000001FF\n', sha256: '' };

type OhmsResult = { ohms: number | null; reason?: OhmsRefusal };
