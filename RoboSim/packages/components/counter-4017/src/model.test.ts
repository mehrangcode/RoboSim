import { UNO_ELECTRICAL, avrUno } from '@robosim/board-avr-uno';
import { validateManifest } from '@robosim/sim-core';
import { bench, dcSupply, firmware, fixedResistor } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { definition, manifest, type DecadeCounterState } from './index.js';

/** Pulses D2 (CLK) `n` times as fast as the AVR can; INH and RST tied as given. */
function rig(n: number, tie: { inh?: 'vdd'; rst?: 'vdd' } = {}) {
  const fw = firmware(`
      ldi r16, 0x04
      out 0x0A, r16          ; D2 output
      ldi r19, ${n}
    pulse:
      sbi 0x0B, 2
      cbi 0x0B, 2
      dec r19
      brne pulse
    halt: rjmp halt
  `);
  const tied = (pin: 'inh' | 'rst'): [string, string][] =>
    tie[pin] === 'vdd' ? [['vdd.pos', `u.${pin}`]] : [];
  return bench({
    parts: {
      vdd: { def: dcSupply, props: { volts: 5, ohms: 0 } },
      u: { def: definition },
      load: { def: fixedResistor, props: { ohms: 1000 } },
    },
    wires: [['vdd.pos', 'u.vdd'], ['mcu.D2', 'u.clk'], ['u.q3', 'load.a'], ...tied('inh'), ...tied('rst')],
    ground: ['vdd.neg', 'u.vss', 'load.b', ...(tie.inh ? [] : ['u.inh']), ...(tie.rst ? [] : ['u.rst'])],
    mcu: { core: avrUno.createCore(fw), electrical: UNO_ELECTRICAL, pins: ['D2'] },
  });
}

describe('ic.cd4017', () => {
  it('has a valid manifest', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('counts rising clock edges modulo 10 with carry-out HIGH for 0–4', () => {
    const b = rig(13);
    b.run(0.005);
    expect(b.state<DecadeCounterState>('u')).toMatchObject({ count: 3, carry: 1 });
    // Weak CMOS output: ≈ 0.8 kΩ against the 1 kΩ load.
    expect(b.volts('u.q3')).toBeCloseTo(5 * (1000 / 1800), 1);
    const seven = rig(7);
    seven.run(0.005);
    expect(seven.state<DecadeCounterState>('u')).toMatchObject({ count: 7, carry: 0 });
  });

  it('holds while INH is HIGH and sits at Q0 while RST is HIGH', () => {
    const inhibited = rig(5, { inh: 'vdd' });
    inhibited.run(0.005);
    expect(inhibited.state<DecadeCounterState>('u').count).toBe(0);
    const reset = rig(5, { rst: 'vdd' });
    reset.run(0.005);
    expect(reset.state<DecadeCounterState>('u').count).toBe(0);
  });
});
