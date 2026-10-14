import { validateManifest } from '@robosim/sim-core';
import { bench, dcSupply, fixedResistor } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { breadboardFull, breadboardHalf, definitions } from './index.js';

describe('passive.breadboard-*', () => {
  it('has valid manifests with the advertised tie points', () => {
    for (const d of definitions) expect(validateManifest(d.manifest)).toEqual([]);
    expect(breadboardHalf.manifest.pins).toHaveLength(400);
    expect(breadboardFull.manifest.pins).toHaveLength(830);
  });

  it('joins a–e and f–j per column, never across the centre gap, and rails end to end', () => {
    const b = bench({ parts: { bb: { def: breadboardHalf } } });
    const same = (x: string, y: string) => b.net(`bb.${x}`) === b.net(`bb.${y}`);
    expect(same('3a', '3e')).toBe(true);
    expect(same('3f', '3j')).toBe(true);
    expect(same('3e', '3f')).toBe(false); // centre channel
    expect(same('3a', '4a')).toBe(false);
    expect(same('tp1', 'tp25')).toBe(true);
    expect(same('tp1', 'tn1')).toBe(false);
  });

  it('carries current through strips like wires', () => {
    // supply + → rail tp → wire to 10a; resistor 10e–20e; 20a → ground rail
    const b = bench({
      parts: {
        bb: { def: breadboardHalf },
        src: { def: dcSupply, props: { volts: 5, ohms: 0 } },
        r: { def: fixedResistor, props: { ohms: 1000 } },
      },
      wires: [
        ['src.pos', 'bb.tp1'],
        ['bb.tp20', 'bb.10a'],
        ['r.a', 'bb.10e'],
        ['r.b', 'bb.20e'],
        ['bb.20a', 'bb.tn5'],
      ],
      ground: ['src.neg', 'bb.tn1'],
    });
    b.run(0.002);
    expect(b.volts('bb.10c')).toBeCloseTo(5, 6);
    expect(b.state<{ currentMa: number }>('r').currentMa).toBeCloseTo(5, 6);
  });
});
