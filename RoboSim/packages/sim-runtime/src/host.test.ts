import { describe, expect, it } from 'vitest';
import type { Frame, SceneInfo, WorkerToMain } from './protocol.js';
import { SimHost } from './host.js';

function harness() {
  let wall = 0;
  const messages: WorkerToMain[] = [];
  const host = new SimHost(
    (m) => messages.push(m),
    () => wall,
  );
  const frames = () =>
    messages
      .filter((m): m is Extract<WorkerToMain, { type: 'frame' }> => m.type === 'frame')
      .map((m) => m.frame);
  const scene = () => (messages.find((m) => m.type === 'loaded') as { scene: SceneInfo } | undefined)?.scene;
  /** Advance wall time in 16 ms worker ticks. */
  const advance = (ms: number) => {
    for (let t = 0; t < ms; t += 16) {
      wall += 16;
      host.tick();
    }
  };
  return { host, messages, frames, scene, advance, last: (): Frame | undefined => frames().at(-1) };
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
    h.host.handle({ type: 'input', componentId: 'pot', name: 'position', value: 1 }); // wiper at 0 V → 500 µs → 0°
    h.host.handle({ type: 'control', action: 'run' });
    h.advance(600);
    expect((h.last()?.parts['servo'] as { angleDeg: number }).angleDeg).toBeLessThan(2);
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
