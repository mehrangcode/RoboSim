import { describe, expect, it } from 'vitest';
import type { ComponentPose, RayHit, Vec2, WorldModel } from './contracts.js';
import { irReflectance, sonarRange, toWorld } from './sensors.js';

/** Floor: black (0) for x < 0, white (1) otherwise. One wall: the line x = 1 m. */
const world: WorldModel = {
  step: () => undefined,
  bodies: () => [],
  componentPose: () => null,
  sampleFloor: (p: Vec2) => (p.x < 0 ? 0 : 1),
  raycast(origin: Vec2, dir: Vec2, maxDist: number): RayHit | null {
    if (dir.x <= 0) return null;
    const t = (1 - origin.x) / dir.x;
    return t <= maxDist ? { point: { x: 1, y: origin.y + dir.y * t }, distance: t, bodyId: 'wall' } : null;
  },
};
const pose = (x: number, angle = 0, heightMm = 5): ComponentPose => ({
  position: { x, y: 0 },
  angle,
  heightMm,
});

describe('sensor physics', () => {
  it('maps local mm offsets through the component pose', () => {
    const p = toWorld(pose(1, Math.PI / 2), { x: 10, y: 0 });
    expect(p.x).toBeCloseTo(1, 12);
    expect(p.y).toBeCloseTo(0.01, 12);
  });

  it('IR reflectance follows the floor and fades with mounting height', () => {
    expect(irReflectance(world, pose(0.1))).toBe(1);
    expect(irReflectance(world, pose(-0.1))).toBe(0);
    expect(irReflectance(world, pose(0.1, 0, 16.5))).toBeCloseTo(0.5, 12);
    expect(irReflectance(world, pose(0.1, 0, 30))).toBe(0);
  });

  it('sonar returns the nearest hit inside the cone and range', () => {
    expect(sonarRange(world, pose(0.5))).toBeCloseTo(0.5, 12); // centre ray is shortest
    expect(sonarRange(world, pose(0.99))).toBeNull(); // closer than 2 cm
    expect(sonarRange(world, pose(-4))).toBeNull(); // beyond 4 m
    expect(sonarRange(world, pose(0.5, Math.PI))).toBeNull(); // facing away
  });
});
