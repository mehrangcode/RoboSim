import type { BodySnapshot, ComponentPose, RayHit, Vec2, WorldModel } from '@robosim/sim-core';
import { dmath } from '@robosim/sim-core';

export interface Mount {
  /** Position on the robot (mm, +x forward, +y left). */
  readonly xMm: number;
  readonly yMm: number;
  /** Heading relative to the robot (rad). */
  readonly angle?: number;
  readonly heightMm: number;
}

export interface TestArenaOptions {
  /** Floor luminance 0 (black) .. 1 (white) at a world point (m). Default: all white. */
  readonly floor?: (p: Vec2) => number;
  /** Obstacle segments [a, b] in metres. */
  readonly walls?: readonly (readonly [Vec2, Vec2])[];
  /** Component id → mount on the robot. */
  readonly mounts?: Readonly<Record<string, Mount>>;
}

/**
 * Deterministic stand-in for the physics world in component tests: a robot pose you set by hand,
 * analytic floor and wall segments. The real planck.js world replaces it in slice 4.
 */
export class TestArena implements WorldModel {
  private robot = { x: 0, y: 0, angle: 0 };
  private readonly floor: (p: Vec2) => number;
  private readonly walls: readonly (readonly [Vec2, Vec2])[];
  private readonly mounts: Readonly<Record<string, Mount>>;

  constructor(options: TestArenaOptions = {}) {
    this.floor = options.floor ?? (() => 1);
    this.walls = options.walls ?? [];
    this.mounts = options.mounts ?? {};
  }

  setRobot(x: number, y: number, angle = 0): void {
    this.robot = { x, y, angle };
  }

  step(): void {}

  bodies(): readonly BodySnapshot[] {
    return [{ id: 'robot', position: { x: this.robot.x, y: this.robot.y }, angle: this.robot.angle }];
  }

  componentPose(componentId: string): ComponentPose | null {
    const m = this.mounts[componentId];
    if (!m) return null;
    const c = dmath.cos(this.robot.angle);
    const s = dmath.sin(this.robot.angle);
    const x = m.xMm / 1000;
    const y = m.yMm / 1000;
    return {
      position: { x: this.robot.x + c * x - s * y, y: this.robot.y + s * x + c * y },
      angle: this.robot.angle + (m.angle ?? 0),
      heightMm: m.heightMm,
    };
  }

  /** Average of the centre and 8 points at 70 % of the radius. */
  sampleFloor(p: Vec2, radius: number): number {
    let sum = this.floor(p);
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      sum += this.floor({ x: p.x + 0.7 * radius * dmath.cos(a), y: p.y + 0.7 * radius * dmath.sin(a) });
    }
    return sum / 9;
  }

  raycast(origin: Vec2, dir: Vec2, maxDist: number): RayHit | null {
    let best: RayHit | null = null;
    this.walls.forEach(([a, b], i) => {
      // Solve origin + t·dir = a + u·(b − a), t ≥ 0, 0 ≤ u ≤ 1.
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const denom = dir.x * ey - dir.y * ex;
      if (Math.abs(denom) < 1e-12) return;
      const ax = a.x - origin.x;
      const ay = a.y - origin.y;
      const t = (ax * ey - ay * ex) / denom;
      const u = (ax * dir.y - ay * dir.x) / denom;
      if (t < 0 || t > maxDist || u < 0 || u > 1) return;
      if (!best || t < best.distance) {
        best = {
          point: { x: origin.x + dir.x * t, y: origin.y + dir.y * t },
          distance: t,
          bodyId: `wall-${i}`,
        };
      }
    });
    return best;
  }
}
