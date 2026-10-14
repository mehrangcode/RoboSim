import { validateManifest } from '@robosim/sim-core';
import { TestArena, bench, dcSupply } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { definition, manifest, type Line3chState } from './index.js';

function rig(world?: TestArena) {
  return bench({
    parts: { src: { def: dcSupply, props: { volts: 5, ohms: 0 } }, line: { def: definition } },
    wires: [['src.pos', 'line.vcc']],
    ground: ['src.neg', 'line.gnd'],
    ...(world ? { world } : {}),
  });
}

describe('sensor.line-3ch', () => {
  it('has a valid manifest', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('on the bench each channel follows its surface input', () => {
    const b = rig();
    b.input('line', 'surfaceCenter', 0);
    b.run(0.005);
    expect(b.state<Line3chState>('line').outputs).toEqual({ left: 0, center: 1, right: 0 });
    expect(b.volts('line.center')).toBeCloseTo(5, 1);
    expect(b.volts('line.left')).toBeLessThan(0.05);
  });

  it('tracks a 18 mm black line as the robot drifts sideways', () => {
    const world = new TestArena({
      floor: (p) => (Math.abs(p.y) < 0.009 ? 0 : 1),
      mounts: { line: { xMm: 70, yMm: 0, heightMm: 5 } },
    });
    const b = rig(world);
    const at = (y: number) => {
      world.setRobot(0, y);
      b.run(0.003);
      return b.state<Line3chState>('line').outputs;
    };
    expect(at(0)).toEqual({ left: 0, center: 1, right: 0 }); // centred
    expect(at(0.012)).toEqual({ left: 0, center: 0, right: 1 }); // robot drifted left → line under right sensor
    expect(at(-0.012)).toEqual({ left: 1, center: 0, right: 0 });
    expect(at(0.1)).toEqual({ left: 0, center: 0, right: 0 }); // lost the line
  });

  it('respects robot heading (rotated 90°: sensors now lie along the world x axis)', () => {
    const world = new TestArena({
      floor: (p) => (Math.abs(p.x + 0.012) < 0.004 ? 0 : 1), // thin line under the left sensor only
      mounts: { line: { xMm: 0, yMm: 0, heightMm: 5 } },
    });
    world.setRobot(0, 0, Math.PI / 2);
    const b = rig(world);
    b.run(0.003);
    expect(b.state<Line3chState>('line').outputs).toEqual({ left: 1, center: 0, right: 0 });
  });
});
