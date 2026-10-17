import { validateManifest } from '@robosim/sim-core';
import { TestArena, bench, dcSupply } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { definition, manifest, type Line5chState } from './index.js';

function rig(world?: TestArena) {
  return bench({
    parts: { src: { def: dcSupply, props: { volts: 5, ohms: 0 } }, line: { def: definition } },
    wires: [['src.pos', 'line.vcc']],
    ground: ['src.neg', 'line.gnd'],
    ...(world ? { world } : {}),
  });
}

const bits = (s: Line5chState) => (['s1', 's2', 's3', 's4', 's5'] as const).map((c) => s.outputs[c]).join('');

describe('sensor.line-5ch', () => {
  it('has a valid manifest', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('on the bench each channel follows its surface input', () => {
    const b = rig();
    b.input('line', 'surface4', 0);
    b.run(0.005);
    expect(bits(b.state<Line5chState>('line'))).toBe('00010');
    expect(b.volts('line.s4')).toBeCloseTo(5, 1);
  });

  it('reports how far off an 18 mm line the robot is, sensor by sensor', () => {
    const world = new TestArena({
      floor: (p) => (Math.abs(p.y) < 0.009 ? 0 : 1),
      mounts: { line: { xMm: 70, yMm: 0, heightMm: 5 } },
    });
    const b = rig(world);
    const at = (y: number) => {
      world.setRobot(0, y);
      b.run(0.003);
      return bits(b.state<Line5chState>('line'));
    };
    expect(at(0)).toBe('00100');
    expect(at(0.015)).toBe('00010'); // drifted left by one spacing → line under S4
    expect(at(0.03)).toBe('00001');
    expect(at(-0.03)).toBe('10000');
    expect(at(0.2)).toBe('00000');
  });
});
