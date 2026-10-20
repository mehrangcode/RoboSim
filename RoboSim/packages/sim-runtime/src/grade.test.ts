import { describe, expect, it } from 'vitest';
import { SimClient } from './client.js';
import { ENGINE_VERSION } from './engine-version.js';
import { firmware } from '@robosim/test-fixtures';
import { EngineVersionMismatchError, MAX_SERIAL_CHARS, grade, traceDigest, type GradeJob } from './grade.js';
import { SimHost } from './host.js';
import type { InputLog, InputLogEntry, ScenarioId, WorkerToMain } from './protocol.js';
import { builtinSource } from './scenarios.js';

const job = (scenario: ScenarioId, maxSimSeconds: number, entries: InputLogEntry[] = []): GradeJob => ({
  log: { engineVersion: ENGINE_VERSION, scenario, ...builtinSource(scenario), seed: 1, entries },
  maxSimSeconds,
});

describe('grade', () => {
  it('runs the line follower until the challenge decides and samples the pose at 10 Hz', () => {
    const r = grade(job('line-follower', 60));
    expect(r).toMatchObject({ outcome: 'success', endSlice: 14440, score: { total: 100, max: 100 } });
    expect(r.challenge?.decidedAt).toBe(14.44);
    const slices = r.trace.samples.map((s) => s.slice);
    expect(slices.slice(0, 3)).toEqual([0, 100, 200]);
    expect(slices.at(-1)).toBe(14440); // the decisive slice closes the trace
    expect(r.final).toBe(r.trace.samples.at(-1));
    expect(r.final.robot).toHaveLength(3);
  }, 30_000);

  it('runs to the time cap without a challenge and stamps serial output and findings with slices', () => {
    const serial = grade(job('serial', 2.5, [{ slice: 1500, kind: 'serial', text: 'hi' }]));
    expect(serial).toMatchObject({ outcome: 'unresolved', endSlice: 2500, challenge: null, score: null });
    expect(serial.serial).toBe('RoboSim ready\r\ntick 0\r\nHItick 1\r\n');
    expect(serial.trace.serial.find((c) => c.text.includes('H'))?.slice).toBeGreaterThan(1500);

    const motor = grade(job('motor-on-pin', 0.5));
    expect(motor.trace.findings.map((f) => [f.ruleId, f.slice])).toEqual([['SAF-PIN-CURRENT', 55]]);
    expect(motor.damaged).toEqual({ parts: [], pins: ['D9'] });
  }, 30_000);

  it('is deterministic: same job, same trace digest', async () => {
    const entries: InputLogEntry[] = [
      { slice: 100, kind: 'component', componentId: 'pot', name: 'position', value: 0.3 },
      { slice: 600, kind: 'component', componentId: 'pot', name: 'position', value: 0.9 },
    ];
    const a = grade(job('dimmer', 1, entries));
    const b = grade(job('dimmer', 1, entries));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(await traceDigest(a.trace)).toMatch(/^[0-9a-f]{64}$/);
    expect(await traceDigest(a.trace)).toBe(await traceDigest(b.trace));
    expect(await traceDigest(grade(job('dimmer', 1)).trace)).not.toBe(await traceDigest(a.trace));
  }, 30_000);

  it('rejects jobs for another engine version or outside the time cap', () => {
    const j = job('blink', 1);
    expect(() => grade({ ...j, log: { ...j.log, engineVersion: 'sim-core@0.0.1' } })).toThrow(
      EngineVersionMismatchError,
    );
    expect(() => grade({ ...j, maxSimSeconds: 0 })).toThrow(RangeError);
    expect(() => grade({ ...j, maxSimSeconds: 301 })).toThrow(RangeError);
  });

  it('reproduces a live worker run exactly at the slice it was paused', () => {
    let wall = 0;
    const client = new SimClient();
    let log = null as InputLog | null; // set by the callback below
    client.onInputLog = (l) => (log = l);
    const host = new SimHost(
      (m: WorkerToMain) => client.receive(m),
      () => wall,
    );
    const advance = (ms: number) => {
      for (let t = 0; t < ms; t += 16) {
        wall += 16;
        host.tick();
      }
    };
    host.handle({ type: 'load', scenario: 'line-follower' });
    host.handle({ type: 'control', action: 'run' });
    advance(700);
    host.handle({ type: 'speed', value: 4 });
    advance(500);
    host.handle({ type: 'control', action: 'pause' });
    host.handle({ type: 'exportLog' });
    const live = client.frame;
    if (!live?.robot || !log) throw new Error('no live frame or log');

    const r = grade({ log, maxSimSeconds: live.simTime });
    expect(r.endSlice).toBe(Math.round(live.simTime * 1000));
    expect(log.endSlice).toBe(r.endSlice);
    expect(r.final.robot).toEqual([live.robot.x, live.robot.y, live.robot.angle]);
    expect(r.final.pins).toEqual(Object.fromEntries(Object.entries(live.pins).filter(([, p]) => !p.unwired)));
    expect(r.challenge?.tree).toEqual(live.challenge?.tree);
  }, 30_000);
});

describe('grade limits', () => {
  it('keeps the first MAX_SERIAL_CHARS of a 2 Mbaud flood and marks the result truncated', () => {
    // U2X with UBRR0 = 0: 2 Mbaud, an 'A' whenever the data register is empty (≈ 200 kB/s).
    const flood = firmware(`
      ldi r16, 0x02
      sts 0xc0, r16       ; UCSR0A: U2X0
      ldi r16, 0
      sts 0xc5, r16       ; UBRR0H
      sts 0xc4, r16       ; UBRR0L
      ldi r16, 0x08
      sts 0xc1, r16       ; UCSR0B: TXEN0
      ldi r16, 0x41
    loop:
      lds r17, 0xc0
      sbrs r17, 5         ; UDRE0
      rjmp loop
      sts 0xc6, r16       ; UDR0
      rjmp loop
    `);
    const { project } = builtinSource('serial');
    const text = String.fromCharCode(...flood.bytes);
    const r = grade({
      log: {
        engineVersion: ENGINE_VERSION,
        scenario: null,
        project,
        firmware: { format: 'ihex', text, sha256: 'flood' },
        seed: 1,
        entries: [],
      },
      maxSimSeconds: 6,
    });
    expect(r.serial).toHaveLength(MAX_SERIAL_CHARS);
    expect(r.serialTruncated).toBe(true);
    expect(r.trace.serial.reduce((n, c) => n + c.text.length, 0)).toBe(MAX_SERIAL_CHARS);
    expect(r.endSlice).toBe(6000); // the run itself goes on to the cap
  }, 60_000);

  it('leaves ordinary runs untouched', () => {
    expect(grade(job('serial', 2)).serialTruncated).toBeUndefined();
  });
});
