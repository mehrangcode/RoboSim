import { validateManifest } from '@robosim/sim-core';
import { TestArena, bench, dcSupply } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { definition, manifest, type Tcrt5000State } from './index.js';

function rig(world?: TestArena) {
  return bench({
    parts: {
      src: { def: dcSupply, props: { volts: 5, ohms: 0 } },
      ir: { def: definition, props: { noise: 0 } },
    },
    wires: [['src.pos', 'ir.vcc']],
    ground: ['src.neg', 'ir.gnd'],
    ...(world ? { world } : {}),
  });
}

describe('sensor.tcrt5000', () => {
  it('has a valid manifest', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('on the bench: white → A0 low, D0 LOW, indicator on; black → A0 high, D0 HIGH', () => {
    const b = rig();
    b.run(0.005);
    expect(b.state<Tcrt5000State>('ir')).toMatchObject({ mounted: false, d0: 0, indicator: true });
    expect(b.volts('ir.a0')).toBeCloseTo(0.75, 1);
    expect(b.volts('ir.d0')).toBeLessThan(0.05);

    b.input('ir', 'surface', 0);
    b.run(0.005);
    expect(b.state<Tcrt5000State>('ir')).toMatchObject({ d0: 1, indicator: false });
    expect(b.volts('ir.a0')).toBeCloseTo(5, 1);
    expect(b.volts('ir.d0')).toBeCloseTo(5, 1);
  });

  it('mounted on a robot it reads the arena floor (black line at |y| < 9 mm)', () => {
    const world = new TestArena({
      floor: (p) => (Math.abs(p.y) < 0.009 ? 0 : 1),
      mounts: { ir: { xMm: 60, yMm: 0, heightMm: 5 } },
    });
    const b = rig(world);
    b.run(0.005);
    expect(b.state<Tcrt5000State>('ir')).toMatchObject({ mounted: true, reflectance: 0, d0: 1 });
    world.setRobot(0, 0.05); // 5 cm sideways: off the line
    b.run(0.005);
    expect(b.state<Tcrt5000State>('ir')).toMatchObject({ reflectance: 1, d0: 0 });
  });

  it('loses the signal when mounted too high', () => {
    const world = new TestArena({ mounts: { ir: { xMm: 0, yMm: 0, heightMm: 40 } } });
    const b = rig(world);
    b.run(0.005);
    expect(b.state<Tcrt5000State>('ir')).toMatchObject({ reflectance: 0, d0: 1 }); // reads "black" everywhere
  });

  it('stays silent when unpowered', () => {
    const b = bench({ parts: { ir: { def: definition } } });
    b.run(0.005);
    expect(b.state<Tcrt5000State>('ir')).toMatchObject({ d0: 0, a0V: 0, indicator: false });
  });

  it('noise is seeded: identical runs give identical readings', () => {
    const read = () => {
      const b = bench({
        parts: {
          src: { def: dcSupply, props: { volts: 5, ohms: 0 } },
          ir: { def: definition, props: { noise: 0.05 } },
        },
        wires: [['src.pos', 'ir.vcc']],
        ground: ['src.neg', 'ir.gnd'],
        seed: 42,
      });
      return Array.from({ length: 5 }, () => {
        b.run(0.003);
        return b.state<Tcrt5000State>('ir').a0V;
      });
    };
    const a = read();
    expect(read()).toEqual(a);
    expect(new Set(a).size).toBeGreaterThan(1);
  });
});
