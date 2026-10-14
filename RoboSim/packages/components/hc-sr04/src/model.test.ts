import { UNO_ELECTRICAL, avrUno } from '@robosim/board-avr-uno';
import { validateManifest } from '@robosim/sim-core';
import { TestArena, bench, dcSupply, firmware } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { definition, manifest, type HcSr04State } from './index.js';

/**
 * Sketch equivalent: pulse TRIG (D9) for ~11 µs, then mirror ECHO (D8) onto D13 so the test can read
 * the echo width from D13's cycle-stamped edges — the same precision `pulseIn()` would see.
 */
const FIRMWARE = firmware(`
    ldi r16, 0x22
    out 0x04, r16          ; DDRB: D9 (TRIG) and D13 outputs, D8 (ECHO) input
    sbi 0x05, 1            ; TRIG high
    ldi r17, 60
  d: dec r17
    brne d                 ; ~180 cycles ≈ 11 µs
    cbi 0x05, 1            ; TRIG low
  loop:
    sbic 0x03, 0
    sbi 0x05, 5
    sbis 0x03, 0
    cbi 0x05, 5
    rjmp loop
`);

function rig(opts: { world?: TestArena; distanceCm?: number; supplyV?: number } = {}) {
  const core = avrUno.createCore(FIRMWARE);
  const widths: number[] = [];
  let rise = 0;
  core.onPinEdge((pin, level, cycle) => {
    if (pin !== 'D13') return;
    if (level === 1) rise = cycle;
    else widths.push((cycle - rise) / 16e6);
  });
  const b = bench({
    parts: {
      src: { def: dcSupply, props: { volts: opts.supplyV ?? 5, ohms: 0 } },
      sonar: { def: definition },
    },
    wires: [
      ['src.pos', 'sonar.vcc'],
      ['mcu.D9', 'sonar.trig'],
      ['mcu.D8', 'sonar.echo'],
    ],
    ground: ['src.neg', 'sonar.gnd'],
    mcu: { core, electrical: UNO_ELECTRICAL, pins: ['D8', 'D9', 'D13'] },
    ...(opts.world ? { world: opts.world } : {}),
  });
  if (opts.distanceCm !== undefined) b.input('sonar', 'distanceCm', opts.distanceCm);
  return { b, widths };
}

describe('sensor.hc-sr04', () => {
  it('has a valid manifest', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('echo width encodes the bench distance with sub-millimetre precision', () => {
    const { b, widths } = rig({ distanceCm: 25 });
    b.run(0.01);
    expect(widths).toHaveLength(1);
    const cm = (((widths[0] ?? 0) * 343) / 2) * 100;
    expect(Math.abs(cm - 25)).toBeLessThan(0.05);
    expect(b.state<HcSr04State>('sonar')).toMatchObject({ distanceCm: 25, mounted: false, echoHigh: false });
  });

  it('mounted on a robot it ranges the nearest wall in its cone', () => {
    const world = new TestArena({
      walls: [
        [
          { x: 0.6, y: -1 },
          { x: 0.6, y: 1 },
        ],
      ],
      mounts: { sonar: { xMm: 100, yMm: 0, heightMm: 60 } },
    });
    const { b, widths } = rig({ world });
    b.run(0.01);
    const cm = (((widths[0] ?? 0) * 343) / 2) * 100;
    expect(cm).toBeCloseTo(50, 1); // wall 60 cm ahead, sensor 10 cm forward on the chassis
    expect(b.state<HcSr04State>('sonar').mounted).toBe(true);
  });

  it('nothing in range → timeout pulse; too close → timeout too', () => {
    for (const d of [500, 1]) {
      const { b, widths } = rig({ distanceCm: d });
      b.run(0.06);
      expect(widths[0]).toBeCloseTo(0.038, 6);
      expect(b.state<HcSr04State>('sonar').distanceCm).toBeNull();
    }
  });

  it('does not respond when under-powered', () => {
    const { b, widths } = rig({ distanceCm: 25, supplyV: 3.3 });
    b.run(0.01);
    expect(widths).toEqual([]);
  });

  it('drives the ECHO pin electrically while the pulse is high', () => {
    const { b } = rig({ distanceCm: 100 }); // 5.83 ms pulse
    b.run(0.003);
    expect(b.state<HcSr04State>('sonar').echoHigh).toBe(true);
    expect(b.volts('sonar.echo')).toBeGreaterThan(4.9);
    b.run(0.01);
    expect(b.state<HcSr04State>('sonar').echoHigh).toBe(false);
  });
});
