import { validateManifest } from '@robosim/sim-core';
import { TestArena, bench, dcSupply, fixedResistor } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { definition, manifest, type BumpSwitchState } from './index.js';

/** 5 V through 1 kΩ into COM; NO and NC each to a 1 kΩ load, so the closed side reads ≈ 2.5 V. */
function rig(world?: TestArena) {
  return bench({
    parts: {
      src: { def: dcSupply, props: { volts: 5, ohms: 0 } },
      r: { def: fixedResistor, props: { ohms: 1000 } },
      ln: { def: fixedResistor, props: { ohms: 1000 } },
      lc: { def: fixedResistor, props: { ohms: 1000 } },
      sw: { def: definition },
    },
    wires: [
      ['src.pos', 'r.a'],
      ['r.b', 'sw.com'],
      ['sw.no', 'ln.a'],
      ['sw.nc', 'lc.a'],
    ],
    ground: ['src.neg', 'ln.b', 'lc.b'],
    ...(world ? { world } : {}),
  });
}

describe('sensor.bump-switch', () => {
  it('has a valid manifest', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('switches COM from NC to NO while pressed on the bench', () => {
    const b = rig();
    b.run(0.002);
    expect(b.volts('sw.nc')).toBeCloseTo(2.5, 2);
    expect(b.volts('sw.no')).toBeCloseTo(0, 3);
    b.input('sw', 'pressed', true);
    b.run(0.002);
    expect(b.volts('sw.no')).toBeCloseTo(2.5, 2);
    expect(b.state<BumpSwitchState>('sw')).toMatchObject({ pressed: true, bumped: false });
  });

  it('on a robot, a wall within the lever reach presses it; farther away it is released', () => {
    // Switch 60 mm ahead of the robot centre, facing forward; lever reach = 6.5 + 12 mm.
    const wall = (x: number) =>
      [
        { x, y: -1 },
        { x, y: 1 },
      ] as const;
    const near = new TestArena({ walls: [wall(0.075)], mounts: { sw: { xMm: 60, yMm: 0, heightMm: 20 } } });
    const pressed = rig(near);
    pressed.run(0.002);
    expect(pressed.state<BumpSwitchState>('sw')).toMatchObject({
      mounted: true,
      bumped: true,
      pressed: true,
    });
    const far = new TestArena({ walls: [wall(0.09)], mounts: { sw: { xMm: 60, yMm: 0, heightMm: 20 } } });
    const free = rig(far);
    free.run(0.002);
    expect(free.state<BumpSwitchState>('sw').pressed).toBe(false);
  });
});
