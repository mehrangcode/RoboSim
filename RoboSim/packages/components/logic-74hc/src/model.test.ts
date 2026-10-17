import { UNO_ELECTRICAL, avrUno } from '@robosim/board-avr-uno';
import { validateManifest, type Level } from '@robosim/sim-core';
import { bench, dcSupply, firmware, fixedResistor } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { definitions, hc00, hc08, hc14, hc32, hc86, type GateArrayState } from './index.js';

/** One 74HC chip on 5 V with gate 1's inputs held at the given levels and a 10 kΩ load on 1Y. */
function gate1(def: (typeof definitions)[number], a: Level, b: Level = 0) {
  const two = def !== hc14;
  return bench({
    parts: {
      vcc: { def: dcSupply, props: { volts: 5, ohms: 0 } },
      ina: { def: dcSupply, props: { volts: a * 5, ohms: 0 } },
      ...(two ? { inb: { def: dcSupply, props: { volts: b * 5, ohms: 0 } } } : {}),
      ic: { def },
      load: { def: fixedResistor, props: { ohms: 10_000 } },
    },
    wires: [
      ['vcc.pos', 'ic.vcc'],
      ['ina.pos', 'ic.1a'],
      ...(two ? ([['inb.pos', 'ic.1b']] as const) : []),
      ['ic.1y', 'load.a'],
    ],
    ground: ['vcc.neg', 'ina.neg', ...(two ? ['inb.neg'] : []), 'ic.gnd', 'load.b'],
  });
}

const out1 = (def: (typeof definitions)[number], a: Level, b: Level = 0): Level => {
  const b2 = gate1(def, a, b);
  b2.run(0.002);
  const v = b2.volts('ic.1y');
  expect(v > 4.9 || v < 0.1).toBe(true);
  return v > 2.5 ? 1 : 0;
};

describe('74HC gate arrays', () => {
  it('have valid manifests', () => {
    for (const d of definitions) expect(validateManifest(d.manifest)).toEqual([]);
  });

  it('follow their truth tables with rail-to-rail outputs', () => {
    const table = (def: (typeof definitions)[number]) =>
      (
        [
          [0, 0],
          [0, 1],
          [1, 0],
          [1, 1],
        ] as const
      )
        .map(([a, b]) => out1(def, a, b))
        .join('');
    expect(table(hc00)).toBe('1110');
    expect(table(hc08)).toBe('0001');
    expect(table(hc32)).toBe('0111');
    expect(table(hc86)).toBe('0110');
    expect([out1(hc14, 0), out1(hc14, 1)]).toEqual([1, 0]);
  });

  it('a 4 mA load pulls a HIGH output to ≈ 4.8 V (≈ 45 Ω driver)', () => {
    const b = bench({
      parts: {
        vcc: { def: dcSupply, props: { volts: 5, ohms: 0 } },
        ic: { def: hc14 },
        load: { def: fixedResistor, props: { ohms: 1200 } },
      },
      wires: [
        ['vcc.pos', 'ic.vcc'],
        ['ic.1y', 'load.a'],
      ],
      ground: ['vcc.neg', 'ic.gnd', 'ic.1a', 'load.b'],
    });
    b.run(0.002);
    expect(b.volts('ic.1y')).toBeCloseTo(5 * (1200 / 1245), 2);
  });

  it('settles a chain of three inverters within one slice', () => {
    const b = bench({
      parts: {
        vcc: { def: dcSupply, props: { volts: 5, ohms: 0 } },
        ic: { def: hc14 },
      },
      wires: [
        ['vcc.pos', 'ic.vcc'],
        ['vcc.pos', 'ic.1a'],
        ['ic.1y', 'ic.2a'],
        ['ic.2y', 'ic.3a'],
      ],
      ground: ['vcc.neg', 'ic.gnd'],
    });
    b.run(0.001);
    expect(b.state<GateArrayState>('ic').outputs.slice(0, 3)).toEqual([0, 1, 0]);
    expect(b.sim.logicUnsettled).toBe(false);
  });

  it('flags a ring oscillator (an inverter feeding itself) as unsettled', () => {
    const b = bench({
      parts: { vcc: { def: dcSupply, props: { volts: 5, ohms: 0 } }, ic: { def: hc14 } },
      wires: [
        ['vcc.pos', 'ic.vcc'],
        ['ic.1y', 'ic.1a'],
      ],
      ground: ['vcc.neg', 'ic.gnd'],
    });
    b.run(0.003);
    expect(b.sim.logicUnsettled).toBe(true);
  });

  it('floats its outputs without supply and flags a shorted output', () => {
    const unpowered = bench({
      parts: { ic: { def: hc00 }, load: { def: fixedResistor, props: { ohms: 10_000 } } },
      wires: [['ic.1y', 'load.a']],
      ground: ['ic.gnd', 'load.b'],
    });
    unpowered.run(0.002);
    expect(unpowered.state<GateArrayState>('ic')).toMatchObject({
      powered: false,
      outputs: [null, null, null, null],
    });
    const shorted = bench({
      parts: { vcc: { def: dcSupply, props: { volts: 5, ohms: 0 } }, ic: { def: hc00 } },
      wires: [['vcc.pos', 'ic.vcc']],
      ground: ['vcc.neg', 'ic.gnd', 'ic.1y'],
    });
    expect(shorted.run(0.002).faults.map((f) => f.code)).toEqual(['OVER_CURRENT']);
  });

  it('answers the firmware at the next instruction (MCU edge fast path)', () => {
    // D2 → 74HC14 → D3. After a 16 ms wait, set D2 HIGH and read PIND right away: the inverter must
    // already read LOW, then D13 reports it (HIGH = fast path worked).
    const fw = firmware(`
      ldi r16, 0x04
      out 0x0A, r16          ; DDRD: D2 output
      ldi r16, 0x20
      out 0x04, r16          ; DDRB: D13 output
      ldi r24, 0x00
      ldi r25, 0x00
    wait:
      sbiw r24, 1
      brne wait              ; ≈ 16 ms
      sbi 0x0B, 2            ; D2 HIGH
      nop
      in r17, 0x09           ; PIND
      sbrs r17, 3            ; D3 still HIGH? skip
      sbi 0x05, 5            ; D3 LOW → D13 HIGH
    halt: rjmp halt
    `);
    const b = bench({
      parts: { vcc: { def: dcSupply, props: { volts: 5, ohms: 0 } }, ic: { def: hc14 } },
      wires: [
        ['vcc.pos', 'ic.vcc'],
        ['mcu.D2', 'ic.1a'],
        ['ic.1y', 'mcu.D3'],
      ],
      ground: ['vcc.neg', 'ic.gnd'],
      mcu: { core: avrUno.createCore(fw), electrical: UNO_ELECTRICAL, pins: ['D2', 'D3', 'D13'] },
    });
    b.run(0.03);
    expect(b.sim.mcu?.pinOutputs().get('D13')?.level).toBe(1);
  });
});
