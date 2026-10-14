import { resolveProps, validateManifest } from '@robosim/sim-core';
import { TestArena, bench } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import {
  chassisGeometry,
  definition,
  manifest,
  type Chassis2wdProps,
  type Chassis2wdState,
} from './index.js';

const defaults = resolveProps(manifest) as unknown as Chassis2wdProps;

describe('mechanical.chassis-2wd', () => {
  it('has a valid manifest without electrical pins', () => {
    expect(validateManifest(manifest)).toEqual([]);
    expect(manifest.pins).toEqual([]);
  });

  it('derives wheel, caster and footprint geometry in the robot frame (m)', () => {
    const g = chassisGeometry(defaults);
    expect(g.wheels).toEqual([
      { side: 'left', position: { x: 0, y: 0.065 }, radiusM: 0.0325 },
      { side: 'right', position: { x: 0, y: -0.065 }, radiusM: 0.0325 },
    ]);
    expect(g.caster).toEqual({ x: -0.11, y: 0 });
    expect(g.footprint[0]?.x).toBeCloseTo(-0.135, 12);
    expect(g.footprint[2]?.x).toBeCloseTo(0.075, 12);
    expect(g.mountSlots.map((s) => s.id)).toEqual([
      'motor-left',
      'motor-right',
      'front-bracket',
      'front-top',
      'deck',
    ]);
  });

  it('computes plate inertia with the parallel-axis shift', () => {
    const g = chassisGeometry(defaults);
    const m = 0.16;
    expect(g.bodyInertiaKgM2).toBeCloseTo((m * (0.21 ** 2 + 0.15 ** 2)) / 12 + m * 0.03 ** 2, 12);
  });

  it('reports the robot pose from the world, or null on the bench', () => {
    const benchOnly = bench({ parts: { chassis: { def: definition } } });
    benchOnly.run(0.002);
    expect(benchOnly.state<Chassis2wdState>('chassis').pose).toBeNull();

    const world = new TestArena();
    world.setRobot(0.5, 0.25, 1);
    const inArena = bench({ parts: { chassis: { def: definition } }, world });
    inArena.run(0.002);
    expect(inArena.state<Chassis2wdState>('chassis').pose).toEqual({
      id: 'robot',
      position: { x: 0.5, y: 0.25 },
      angle: 1,
    });
  });
});
