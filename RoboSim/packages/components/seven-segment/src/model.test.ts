import { validateManifest } from '@robosim/sim-core';
import { bench, dcSupply, fixedResistor } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { definition, manifest, SEGMENTS, type SevenSegmentState } from './index.js';

/** Lights `segments` from 5 V through 220 Ω each; the common goes to ground via `com2` (or `com1`). */
function digit(segments: readonly string[], commonPin = 'com2', ohms = 220) {
  const parts: Record<string, unknown> = {
    src: { def: dcSupply, props: { volts: 5, ohms: 0 } },
    seg: { def: definition },
  };
  const wires: [string, string][] = [];
  for (const s of segments) {
    parts[`r${s}`] = { def: fixedResistor, props: { ohms } };
    wires.push(['src.pos', `r${s}.a`], [`r${s}.b`, `seg.${s}`]);
  }
  return bench({ parts: parts as never, wires, ground: ['src.neg', `seg.${commonPin}`] });
}

describe('display.seven-segment', () => {
  it('has a valid manifest', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('shows a "1" (segments b and c) through either common pin', () => {
    for (const pin of ['com1', 'com2']) {
      const b = digit(['b', 'c'], pin);
      expect(b.run(0.002).faults).toEqual([]);
      const lit = b
        .state<SevenSegmentState>('seg')
        .brightness.map((v, i) => (v > 0.5 ? SEGMENTS[i] : null))
        .filter(Boolean);
      expect(lit).toEqual(['b', 'c']);
    }
  });

  it('flags a segment without its resistor', () => {
    const faults = digit(['a'], 'com1', 1).run(0.002).faults;
    expect(faults.map((f) => [f.code, f.params['segment']])).toEqual([['OVER_CURRENT', 'a']]);
  });
});
