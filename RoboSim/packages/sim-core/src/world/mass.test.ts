import { describe, expect, it } from 'vitest';
import { boxInertia, plateCentroid, robotMass } from './mass.js';

const plate = {
  footprint: [
    { x: -0.135, y: -0.075 },
    { x: 0.075, y: -0.075 },
    { x: 0.075, y: 0.075 },
    { x: -0.135, y: 0.075 },
  ],
  caster: { x: -0.11, y: 0 },
  bodyMassKg: 0.16,
  bodyInertiaKgM2: 0.001,
};

describe('FR-ARN-09 robot mass distribution', () => {
  it('is the plate alone without payload', () => {
    const m = robotMass(plate, []);
    expect(m.massKg).toBe(0.16);
    expect(m.center.x).toBeCloseTo(plateCentroid(plate).x, 15);
    expect(m.center.y).toBe(0);
    expect(m.inertiaKgM2).toBe(0.001);
  });

  it('moves the centre of mass towards a mounted part and shifts load off the caster', () => {
    const rear = robotMass(plate, [{ x: -0.1, y: 0, massKg: 0.1 }]);
    const front = robotMass(plate, [{ x: 0.06, y: 0, massKg: 0.1 }]);
    expect(front.center.x).toBeGreaterThan(rear.center.x);
    expect(front.axleShare).toBeGreaterThan(rear.axleShare);
    expect(front.massKg).toBeCloseTo(0.26, 12);
    // A part off to the side pulls the centre sideways.
    expect(robotMass(plate, [{ x: 0, y: 0.05, massKg: 0.1 }]).center.y).toBeGreaterThan(0);
  });

  it("adds m·r² about the axle midpoint plus the part's own inertia", () => {
    const own = boxInertia(0.1, 60, 40);
    expect(own).toBeCloseTo((0.1 * (0.06 ** 2 + 0.04 ** 2)) / 12, 15);
    const m = robotMass(plate, [{ x: 0.03, y: 0.04, massKg: 0.1, inertiaKgM2: own }]);
    expect(m.inertiaKgM2).toBeCloseTo(0.001 + own + 0.1 * 0.0025, 15);
  });

  it('keeps the load share within 0…1 for a centre of mass beyond the axle or caster', () => {
    expect(robotMass(plate, [{ x: 0.5, y: 0, massKg: 5 }]).axleShare).toBe(1);
    expect(robotMass(plate, [{ x: -0.5, y: 0, massKg: 5 }]).axleShare).toBe(0);
  });
});
