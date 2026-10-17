import { validateManifest } from '@robosim/sim-core';
import { TestArena, bench, dcSupply } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { definition, manifest, type IrObstacleState } from './index.js';

function rig(world?: TestArena, rangeCm = 10) {
  return bench({
    parts: {
      src: { def: dcSupply, props: { volts: 5, ohms: 0 } },
      ir: { def: definition, props: { rangeCm } },
    },
    wires: [['src.pos', 'ir.vcc']],
    ground: ['src.neg', 'ir.gnd'],
    ...(world ? { world } : {}),
  });
}

describe('sensor.ir-obstacle', () => {
  it('has a valid manifest', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('pulls OUT LOW only when something is within its set range (bench)', () => {
    const b = rig();
    b.run(0.002);
    expect(b.volts('ir.out')).toBeCloseTo(5, 2);
    b.input('ir', 'distanceCm', 8);
    b.run(0.002);
    expect(b.state<IrObstacleState>('ir').obstacle).toBe(true);
    expect(b.volts('ir.out')).toBeLessThan(0.05);
    b.input('ir', 'distanceCm', 15);
    b.run(0.002);
    expect(b.state<IrObstacleState>('ir').obstacle).toBe(false);
  });

  it('sees a wall ahead of the robot within the potentiometer range', () => {
    const world = new TestArena({
      walls: [
        [
          { x: 0.2, y: -1 },
          { x: 0.2, y: 1 },
        ],
      ],
      mounts: { ir: { xMm: 80, yMm: 0, heightMm: 30 } },
    });
    const b = rig(world, 15);
    b.run(0.002);
    expect(b.state<IrObstacleState>('ir')).toMatchObject({ mounted: true, obstacle: true });
    expect(b.state<IrObstacleState>('ir').distanceCm).toBeCloseTo(12, 1);
    world.setRobot(-0.1, 0);
    b.run(0.002);
    expect(b.state<IrObstacleState>('ir').obstacle).toBe(false);
  });
});
