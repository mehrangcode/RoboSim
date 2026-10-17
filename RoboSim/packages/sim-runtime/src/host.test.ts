import { describe, expect, it } from 'vitest';
import { SimClient } from './client.js';
import { ENGINE_VERSION } from './engine-version.js';
import { FIRMWARE_HEX } from './firmware/generated.js';
import { FIRMWARE_SKETCHES } from './firmware/sketches.js';
import { HeadlessRun } from './input-log.js';
import type { Frame, InputLog, WorkerToMain } from './protocol.js';
import { SimHost } from './host.js';
import { decodeSerial, standardBaud } from './serial.js';

/** Host + client wired back to back, as worker and UI are; `shared` picks the snapshot transport. */
function harness(shared = false) {
  let wall = 0;
  const messages: WorkerToMain[] = [];
  const client = new SimClient();
  const frames: Frame[] = [];
  const engine = new SimHost(
    (m) => {
      messages.push(m);
      if (client.receive(m) && client.frame && client.frame !== frames.at(-1)) frames.push(client.frame);
    },
    () => wall,
    { shared },
  );
  const poll = () => {
    if (client.poll() && client.frame) frames.push(client.frame);
  };
  // The UI polls the shared buffer every animation frame: model that as a poll after each command.
  const host = {
    handle: (m: Parameters<SimHost['handle']>[0]) => {
      engine.handle(m);
      poll();
    },
  };
  const scene = () => client.scene ?? undefined;
  /** Advance wall time in 16 ms worker ticks; the UI polls the shared buffer after each. */
  const advance = (ms: number) => {
    for (let t = 0; t < ms; t += 16) {
      wall += 16;
      engine.tick();
      poll();
    }
  };
  return {
    host,
    client,
    messages,
    frames,
    scene,
    advance,
    last: (): Frame | undefined => client.frame ?? undefined,
  };
}

describe('SimHost', () => {
  it('loads a bench scenario, describes it, and publishes an initial frame', () => {
    const h = harness();
    h.host.handle({ type: 'load', scenario: 'button' });
    expect(h.scene()).toMatchObject({ scenario: 'button', kind: 'bench', pins: ['D2', 'D13'] });
    expect(h.scene()?.parts.map((p) => p.type)).toEqual([
      'passive.resistor',
      'actuator.led',
      'sensor.push-button',
    ]);
    expect(h.last()).toMatchObject({ running: false, simTime: 0 });
  });

  it('runs paced by wall time and reacts to inputs (button lights the LED)', () => {
    const h = harness();
    h.host.handle({ type: 'load', scenario: 'button' });
    h.host.handle({ type: 'control', action: 'run' });
    h.advance(200);
    const before = h.last();
    expect(before?.simTime).toBeGreaterThan(0.15);
    expect((before?.parts['led'] as { currentMa: number }).currentMa).toBeLessThan(0.01);
    h.host.handle({ type: 'input', componentId: 'btn', name: 'pressed', value: true });
    h.advance(50);
    expect((h.last()?.parts['led'] as { currentMa: number }).currentMa).toBeGreaterThan(10);
    expect(h.last()?.pins['D2']).toMatchObject({ mode: 'input_pullup', level: 0 });
    expect(h.last()?.pins['D2']?.volts).toBeLessThan(0.1);
  });

  it('pause stops simulated time; reset rebuilds the scenario', () => {
    const h = harness();
    h.host.handle({ type: 'load', scenario: 'blink' });
    h.host.handle({ type: 'control', action: 'run' });
    h.advance(100);
    h.host.handle({ type: 'control', action: 'pause' });
    const t = h.last()?.simTime ?? 0;
    h.advance(200);
    expect(h.last()?.simTime).toBe(t);
    h.host.handle({ type: 'control', action: 'reset' });
    expect(h.last()?.simTime).toBe(0);
  });

  it('dimmer: the pot sets LED PWM duty through the ADC', () => {
    const h = harness();
    h.host.handle({ type: 'load', scenario: 'dimmer' });
    h.host.handle({ type: 'input', componentId: 'pot', name: 'position', value: 0.25 }); // wiper 75 % of 5 V
    h.host.handle({ type: 'control', action: 'run' });
    h.advance(100);
    expect(h.last()?.pins['D6']?.duty).toBeCloseTo(0.75, 1);
  });

  it('servo: the pot turns the servo horn', () => {
    const h = harness();
    h.host.handle({ type: 'load', scenario: 'servo' });
    // Wiper at 0 V → 500 µs requested; the Servo library clamps to its 544 µs minimum → ≈ 4° on the SG90.
    h.host.handle({ type: 'input', componentId: 'pot', name: 'position', value: 1 });
    h.host.handle({ type: 'control', action: 'run' });
    h.advance(600);
    expect((h.last()?.parts['servo'] as { angleDeg: number }).angleDeg).toBeCloseTo(4, 0);
  });

  it('line follower: ships the arena + robot scene and drives along the line', () => {
    const h = harness();
    h.host.handle({ type: 'load', scenario: 'line-follower' });
    const scene = h.scene();
    expect(scene?.arena?.floor.widthPx).toBe(1200);
    expect(scene?.robot?.wheels).toHaveLength(2);
    h.host.handle({ type: 'speed', value: 4 });
    h.host.handle({ type: 'control', action: 'run' });
    h.advance(500); // 2 s simulated at 4×
    const f = h.last();
    expect(f?.robot?.x).toBeGreaterThan(0.95); // started at x = 0.9 heading +x
    expect(f?.robot?.sensors).toHaveLength(3);
    expect((f?.parts['motorL'] as { rpm: number }).rpm).toBeGreaterThan(50);
  });

  it('reports errors instead of throwing out of the worker', () => {
    const h = harness();
    h.host.handle({ type: 'load', scenario: 'button' });
    h.host.handle({ type: 'input', componentId: 'ghost', name: 'pressed', value: true });
    expect(h.messages.at(-1)).toMatchObject({ type: 'error' });
  });
});

describe('SimHost safety (slice 5)', () => {
  it('a correctly wired demo has no findings', () => {
    for (const scenario of ['blink', 'button', 'dimmer', 'servo', 'line-follower'] as const) {
      const h = harness();
      h.host.handle({ type: 'load', scenario });
      expect(h.scene()?.staticFindings, scenario).toEqual([]);
      h.host.handle({ type: 'control', action: 'run' });
      h.advance(300);
      expect(h.last()?.findings, scenario).toEqual([]);
    }
  });

  it('LED without resistor: static Errors before Run, then pin + LED burn out while running', () => {
    const h = harness();
    h.host.handle({ type: 'load', scenario: 'led-no-resistor' });
    expect(h.scene()?.staticFindings.map((f) => `${f.ruleId}:${f.severity}`)).toEqual([
      'SAF-LED-NO-RESISTOR:error',
      'SAF-PIN-CURRENT:error',
    ]);
    h.host.handle({ type: 'control', action: 'run' });
    h.advance(1200); // blink turns D13 on at 0.5 s
    const f = h.last();
    expect(f?.damaged.pins).toEqual(['D13']);
    expect(f?.damaged.parts).toEqual(['led']);
    expect(f?.findings.every((x) => x.kind === 'runtime' && x.severity === 'error')).toBe(true);
  });

  it('outputs fighting damages both pins; reset clears the damage', () => {
    const h = harness();
    h.host.handle({ type: 'load', scenario: 'outputs-fighting' });
    h.host.handle({ type: 'control', action: 'run' });
    h.advance(100);
    expect(h.last()?.damaged.pins).toEqual(['D2', 'D3']);
    h.host.handle({ type: 'control', action: 'reset' });
    expect(h.last()?.damaged).toEqual({ parts: [], pins: [] });
  });

  it('floating input warns without damaging anything', () => {
    const h = harness();
    h.host.handle({ type: 'load', scenario: 'floating-input' });
    h.host.handle({ type: 'control', action: 'run' });
    h.advance(600);
    expect(h.last()?.findings.map((f) => `${f.ruleId}:${f.severity}`)).toEqual([
      'SAF-FLOATING-INPUT:warning',
    ]);
    expect(h.last()?.damaged).toEqual({ parts: [], pins: [] });
  });

  it('motor on a pin: inductive-load Error before Run', () => {
    const h = harness();
    h.host.handle({ type: 'load', scenario: 'motor-on-pin' });
    expect(h.scene()?.staticFindings.map((f) => f.ruleId)).toContain('SAF-INDUCTIVE-ON-PIN');
  });
});

describe('SimHost challenge (slice 6)', () => {
  it('tracks the oval challenge live and pauses on the decision with a score', { timeout: 120_000 }, () => {
    const h = harness();
    h.host.handle({ type: 'load', scenario: 'line-follower' });
    expect(h.last()?.challenge).toMatchObject({
      id: 'oval-one-lap',
      status: 'running',
      visitedZones: [],
      nextZone: 'cp-right',
    });
    h.host.handle({ type: 'speed', value: 4 });
    h.host.handle({ type: 'control', action: 'run' });
    h.advance(1500); // 6 s simulated: on the way to the first checkpoint
    expect(h.last()?.challenge?.status).toBe('running');
    h.advance(10_000); // enough wall time for a ~15 s lap at 4×
    const f = h.last();
    expect(f?.challenge?.status).toBe('success');
    expect(f?.running).toBe(false);
    expect(f?.simTime).toBeCloseTo(f?.challenge?.decidedAt ?? 0, 1); // stopped on the decisive slice
    expect(f?.challenge?.visitedZones).toEqual(['cp-right', 'cp-top', 'cp-left']);
    expect(f?.challenge?.score?.total).toBeGreaterThan(95);
    h.host.handle({ type: 'control', action: 'reset' });
    expect(h.last()?.challenge?.status).toBe('running');
  });
});

describe('SimHost worker protocol (slice 7)', () => {
  it('shared-buffer and transferred snapshots deliver identical frames', () => {
    const run = (shared: boolean) => {
      const h = harness(shared);
      h.host.handle({ type: 'load', scenario: 'line-follower' });
      h.host.handle({ type: 'control', action: 'run' });
      h.advance(400);
      h.host.handle({ type: 'control', action: 'pause' });
      return h;
    };
    const shared = run(true);
    const transfer = run(false);
    expect(shared.messages.some((m) => m.type === 'channel')).toBe(true);
    expect(shared.messages.some((m) => m.type === 'snapshot')).toBe(false);
    expect(transfer.messages.some((m) => m.type === 'channel')).toBe(false);
    expect(shared.last()).toEqual(transfer.last());
    expect(shared.last()?.challenge?.tree.type).toBeTruthy(); // strings survive the dictionary
  });

  it('posts the dictionary once; later snapshots are numbers only', () => {
    const h = harness();
    h.host.handle({ type: 'load', scenario: 'button' });
    h.host.handle({ type: 'control', action: 'run' });
    h.advance(300);
    const dicts = h.messages.flatMap((m) => (m.type === 'dict' ? [m.delta] : []));
    expect(dicts.filter((d) => d.paths.length > 0)).toHaveLength(1);
    expect(dicts.slice(1).flatMap((d) => d.strings)).toEqual(['input_pullup', 'output']); // pin modes after boot
    expect(h.messages.filter((m) => m.type === 'snapshot').length).toBeGreaterThan(5);
  });

  it('events carry findings and damage only when they change', () => {
    const h = harness();
    h.host.handle({ type: 'load', scenario: 'outputs-fighting' });
    h.host.handle({ type: 'control', action: 'run' });
    h.advance(300);
    expect(h.messages.filter((m) => m.type === 'damaged')).toHaveLength(1);
    expect(h.messages.filter((m) => m.type === 'findings').length).toBeGreaterThan(0);
    expect(h.last()?.damaged.pins).toEqual(['D2', 'D3']);
  });

  it('serial demo: greets, ticks every second and echoes input upper-cased', () => {
    const h = harness();
    h.host.handle({ type: 'load', scenario: 'serial' });
    expect(h.scene()?.serial).toBe(true);
    h.host.handle({ type: 'control', action: 'run' });
    h.advance(2200); // first tick once millis() reaches 1000
    expect(h.client.serial).toMatch(/^RoboSim ready\r\ntick 0\r\ntick 1\r\n/);
    h.host.handle({ type: 'serial', text: 'hi!' });
    h.advance(100);
    expect(h.client.serial).toContain('HI!');
    expect(h.client.serial.endsWith('HI!') || /HI!(\r\ntick \d\r\n)?$/.test(h.client.serial)).toBe(true);
  });

  it('serial events carry the bytes with their slice and the sketch baud rate (FR-SIM-07)', () => {
    const h = harness();
    h.host.handle({ type: 'load', scenario: 'serial' });
    h.host.handle({ type: 'control', action: 'run' });
    h.advance(1200);
    const chunks = h.client.serialLog.chunks;
    expect(chunks.length).toBeGreaterThan(0);
    expect(new Set(chunks.map((c) => standardBaud(c.baud)))).toEqual(new Set([115200])); // Serial.begin(115200)
    const lines = decodeSerial(chunks, 115200).lines;
    expect(lines.map((l) => l.text)).toEqual(['RoboSim ready', 'tick 0']);
    expect(lines[1]?.slice).toBeGreaterThanOrEqual(1000);
    expect(decodeSerial(chunks, 9600)).toMatchObject({ sketchBaud: 115200, mismatch: true });
  });

  it('pin inspector: every Uno pin, PWM duty and frequency, unwired pins flagged (US-SIM-02 AC1)', () => {
    const h = harness();
    h.host.handle({ type: 'load', scenario: 'dimmer' });
    h.host.handle({ type: 'control', action: 'run' });
    h.advance(200);
    const pins = h.last()?.pins ?? {};
    expect(Object.keys(pins)).toHaveLength(20);
    // analogWrite on D6 → timer0 fast PWM, 16 MHz / 64 / 256.
    expect(pins.D6).toMatchObject({ mode: 'output', duty: expect.any(Number), freqHz: 16e6 / 64 / 256 });
    expect(pins.D6?.unwired).toBeUndefined();
    expect(pins.D2).toMatchObject({ mode: 'input', unwired: true, floating: true });
  });

  it('exports the input log with engine version, scenario and seed', () => {
    const h = harness();
    let log: InputLog | null = null;
    h.client.onInputLog = (l) => (log = l);
    h.host.handle({ type: 'load', scenario: 'button', seed: 7 });
    h.host.handle({ type: 'control', action: 'run' });
    h.advance(100);
    h.host.handle({ type: 'input', componentId: 'btn', name: 'pressed', value: true });
    h.host.handle({ type: 'exportLog' });
    expect(log).toEqual({
      engineVersion: ENGINE_VERSION,
      scenario: 'button',
      project: expect.objectContaining({ meta: { title: 'Button + LED' } }),
      firmware: { format: 'ihex', text: expect.stringMatching(/^:/), sha256: 'demo:button' },
      seed: 7,
      entries: [
        { kind: 'component', componentId: 'btn', name: 'pressed', value: true, slice: expect.any(Number) },
      ],
      endSlice: expect.any(Number),
    });
    // Nothing ran between the input and the export: the log ends where the input was stamped.
    const exported = log as InputLog | null;
    expect(exported?.endSlice).toBe(exported?.entries[0]?.slice);
    expect(exported?.endSlice).toBeGreaterThan(0);
  });

  it('a replayed run is identical to the live run, slice for slice', () => {
    // Live: inputs land at whatever slice wall-clock pacing happened to reach.
    const live = harness();
    let log: InputLog | null = null;
    live.client.onInputLog = (l) => (log = l);
    live.host.handle({ type: 'load', scenario: 'serial', seed: 3 });
    live.host.handle({ type: 'control', action: 'run' });
    live.advance(170);
    live.host.handle({ type: 'serial', text: 'abc' });
    live.advance(90);
    live.host.handle({ type: 'control', action: 'pause' });
    live.host.handle({ type: 'serial', text: 'xyz' }); // while paused
    live.host.handle({ type: 'control', action: 'run' });
    live.advance(300);
    live.host.handle({ type: 'exportLog' });
    const recorded = log as InputLog | null;
    expect(recorded?.entries).toHaveLength(2);

    // Replay through the host (paced differently) and headless: same frames at the same slices.
    const replay = harness();
    replay.host.handle({ type: 'load', scenario: 'serial', seed: 3, inputLog: recorded?.entries ?? [] });
    expect(replay.client.replaying).toBe(2);
    replay.host.handle({ type: 'speed', value: 2 });
    replay.host.handle({ type: 'control', action: 'run' });
    replay.advance(400);
    expect(replay.client.serial.startsWith(live.client.serial)).toBe(true);

    const headless = new HeadlessRun({ scenario: 'serial' }, 3, recorded?.entries ?? []);
    for (const f of live.frames.filter((x) => x.simTime > 0)) {
      headless.runTo(Math.round(f.simTime * 1000));
      const snap = headless.scenario.circuit.sim.snapshot();
      const parts = Object.fromEntries(
        snap.components.filter((c) => c.state !== null).map((c) => [c.id, c.state]),
      );
      expect(parts, `slice ${Math.round(f.simTime * 1000)}`).toEqual(f.parts);
    }
  });

  it('reset after a replay starts a fresh live run', () => {
    const h = harness();
    h.host.handle({
      type: 'load',
      scenario: 'button',
      inputLog: [{ slice: 5, kind: 'component', componentId: 'btn', name: 'pressed', value: true }],
    });
    expect(h.client.replaying).toBe(1);
    h.host.handle({ type: 'control', action: 'reset' });
    expect(h.client.replaying).toBe(0);
  });

  it('a broken replay entry surfaces as an error and pauses the run', () => {
    const h = harness();
    h.host.handle({
      type: 'load',
      scenario: 'button',
      inputLog: [{ slice: 20, kind: 'component', componentId: 'ghost', name: 'pressed', value: true }],
    });
    h.host.handle({ type: 'control', action: 'run' });
    h.advance(100);
    expect(h.client.error).toMatch(/ghost/);
    const t = h.last()?.simTime;
    h.advance(100);
    expect(h.last()?.simTime).toBe(t);
  });
});

describe('SimHost user code on a demo circuit (slice 10)', () => {
  const files = [{ name: 'sketch.ino', content: `${FIRMWARE_SKETCHES.dimmer.trim()}\n` }];
  const firmware = { format: 'ihex', text: FIRMWARE_HEX.dimmer, sha256: 'test:dimmer' } as const;

  it('shows the project code in the scene', () => {
    const h = harness();
    h.host.handle({ type: 'load', scenario: 'blink' });
    expect(h.scene()?.code).toEqual([{ name: 'sketch.ino', content: `${FIRMWARE_SKETCHES.blink.trim()}\n` }]);
  });

  it('runs the given files + firmware on the template circuit as a project of its own', () => {
    const h = harness();
    let log: InputLog | null = null;
    h.client.onInputLog = (l) => (log = l);
    // The dimmer sketch on the dimmer circuit, loaded as user code: the knob drives the LED's PWM.
    h.host.handle({ type: 'load', template: 'dimmer', files, firmware });
    expect(h.scene()).toMatchObject({ scenario: null, title: 'Knob dims an LED', code: files });
    h.host.handle({ type: 'input', componentId: 'pot', name: 'position', value: 0.25 });
    h.host.handle({ type: 'control', action: 'run' });
    h.advance(100);
    expect(h.last()?.pins['D6']?.duty).toBeCloseTo(0.75, 1);
    h.host.handle({ type: 'exportLog' });
    expect(log).toMatchObject({ scenario: null, firmware, project: { code: { files } } });
  });
});
