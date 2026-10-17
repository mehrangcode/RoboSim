import { describe, expect, it } from 'vitest';
import type { ComponentModel, WheelActuator } from '../contracts.js';
import { cos, sin } from '../dmath/index.js';
import { PlanckWorld } from './planck-world.js';
import { boxInertia, plateCentroid } from './mass.js';
import type { ArenaSpec, RobotGeometry, RobotSpec } from './types.js';

/** Constant-torque actuator that records the shaft speed fed back by the world. */
class FakeMotor implements WheelActuator {
  readonly shaftInertia = 0;
  omega = 0;
  constructor(public torque: number) {}
  shaftTorque(): number {
    return this.torque;
  }
  setShaftSpeed(omega: number): void {
    this.omega = omega;
  }
}

const GEOMETRY: RobotGeometry = {
  wheels: [
    { side: 'left', position: { x: 0, y: 0.065 }, radiusM: 0.0325 },
    { side: 'right', position: { x: 0, y: -0.065 }, radiusM: 0.0325 },
  ],
  caster: { x: -0.11, y: 0 },
  footprint: [
    { x: -0.135, y: -0.075 },
    { x: 0.075, y: -0.075 },
    { x: 0.075, y: 0.075 },
    { x: -0.135, y: 0.075 },
  ],
  bodyMassKg: 0.16,
  bodyInertiaKgM2: 0.001,
};

function arena(extra: Partial<ArenaSpec> = {}): ArenaSpec {
  return {
    id: 'test',
    widthM: 3,
    heightM: 3,
    floor: { background: 1, strokes: [] },
    start: { x: 1, y: 1.5, angle: 0 },
    ...extra,
  };
}

function setup(left: number, right: number, a: ArenaSpec = arena(), start = { x: 1, y: 1.5, angle: 0 }) {
  const robot: RobotSpec = {
    id: 'bot',
    geometry: GEOMETRY,
    // Payload spread like the plate (210 × 150 mm).
    payload: [{ ...plateCentroid(GEOMETRY), massKg: 0.34, inertiaKgM2: boxInertia(0.34, 210, 150) }],
    mounts: { sonar: { xMm: 60, yMm: 0, heightMm: 60 }, line: { xMm: 70, yMm: 10, heightMm: 5 } },
    drives: { left: 'mL', right: 'mR' },
    start,
  };
  const world = new PlanckWorld(a, [robot]);
  const motors: Record<string, FakeMotor> = { mL: new FakeMotor(left), mR: new FakeMotor(right) };
  world.bind((id) => motors[id] as unknown as ComponentModel);
  const run = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds / 0.002); i++) world.step(0.002);
  };
  return { world, motors, run, pose: () => world.bodies()[0] };
}

describe('PlanckWorld drivetrain', () => {
  it('equal torque drives straight; wheel speeds are fed back to the motors', () => {
    const { run, pose, motors, world } = setup(0.02, 0.02);
    run(0.5);
    const p = pose();
    expect(p?.position.x).toBeGreaterThan(1.02);
    expect(Math.abs((p?.position.y ?? 0) - 1.5)).toBeLessThan(1e-9);
    expect(Math.abs(p?.angle ?? 1)).toBeLessThan(1e-9);
    const { forward } = world.robotMotion('bot');
    expect(motors['mL']?.omega).toBeCloseTo(forward / 0.0325, 9);
  });

  it('opposite torque pivots about the axle midpoint while grip holds', () => {
    const { run, pose } = setup(-0.004, 0.004);
    run(0.5);
    const p = pose();
    expect(p?.angle).toBeGreaterThan(0.3); // counter-clockwise (left wheel backwards)
    expect(Math.hypot((p?.position.x ?? 0) - 1, (p?.position.y ?? 0) - 1.5)).toBeLessThan(0.005);
  });

  it('skids when the spin needs more centripetal force than the tyres can give', () => {
    // COM sits 3 cm behind the axle: m·ω²·d outgrows μ·N at high yaw rates, so the axle drifts.
    const { run, pose } = setup(-0.05, 0.05);
    run(0.5);
    const p = pose();
    expect(Math.hypot((p?.position.x ?? 0) - 1, (p?.position.y ?? 0) - 1.5)).toBeGreaterThan(0.01);
  });

  it('lateral grip: no sideways drift while turning on an arc', () => {
    const { run, world } = setup(0.004, 0.008);
    run(1);
    // Velocity at the axle midpoint must point along the heading (non-holonomic constraint).
    const motion = world.robotMotion('bot');
    expect(motion.yawRate).toBeGreaterThan(0);
    expect(motion.forward).toBeGreaterThan(0.05);
    expect(Math.abs(motion.lateral)).toBeLessThan(0.02 * motion.forward);
  });

  it('traction limit caps the drive force (huge torque does not teleport the robot)', () => {
    const slow = setup(0.05, 0.05);
    const fast = setup(50, 50);
    slow.run(0.3);
    fast.run(0.3);
    const v = fast.world.robotMotion('bot').forward;
    // a ≤ μ·g·axleShare → v(0.3 s) well under 3 m/s
    expect(v).toBeLessThan(3);
    expect(v).toBeGreaterThan(slow.world.robotMotion('bot').forward);
  });

  it('stops at walls and pushes dynamic obstacles', () => {
    const walled = setup(0.05, 0.05, arena(), { x: 2.6, y: 1.5, angle: 0 });
    walled.run(3);
    // The front (0.075 m ahead) touches the wall at its true outline, within planck's 5 mm slop.
    expect(walled.pose()?.position.x).toBeLessThan(3 - 0.075 + 0.005);
    expect(walled.pose()?.position.x).toBeGreaterThan(3 - 0.075 - 0.005);

    const a = arena({
      perimeterWalls: false,
      obstacles: [
        {
          id: 'can',
          shape: { kind: 'circle', radiusM: 0.03 },
          pose: { x: 1.3, y: 1.5, angle: 0 },
          dynamic: true,
          massKg: 0.05,
        },
      ],
    });
    const pusher = setup(0.03, 0.03, a);
    pusher.run(2);
    const can = pusher.world.bodies().find((b) => b.id === 'can');
    expect(can?.position.x).toBeGreaterThan(1.35);
  });
});

describe('PlanckWorld sensing', () => {
  it('reports mounted component poses through the robot transform', () => {
    const { world } = setup(0, 0, arena(), { x: 1, y: 1, angle: Math.PI / 2 });
    const pose = world.componentPose('line');
    expect(pose?.position.x).toBeCloseTo(1 - 0.01, 9);
    expect(pose?.position.y).toBeCloseTo(1 + 0.07, 9);
    expect(pose?.angle).toBeCloseTo(Math.PI / 2, 12);
    expect(world.componentPose('nope')).toBeNull();
  });

  it('raycasts walls but not the robot it starts inside', () => {
    const { world } = setup(0, 0);
    const sonar = world.componentPose('sonar');
    const hit = world.raycast(sonar?.position ?? { x: 0, y: 0 }, { x: 1, y: 0 }, 4);
    expect(hit?.distance).toBeCloseTo(3 - 1.06, 9);
    expect(hit?.bodyId).toBe('wall');
    expect(world.raycast({ x: 1.06, y: 1.5 }, { x: 0, y: 1 }, 0.5)).toBeNull();
  });

  it('samples the rasterised floor (black line, 1 px = 1 mm)', () => {
    const a = arena({
      floor: {
        background: 1,
        strokes: [
          {
            kind: 'polyline',
            points: [
              { x: 0, y: 1.5 },
              { x: 3, y: 1.5 },
            ],
            widthMm: 18,
            value: 0,
          },
        ],
      },
    });
    const { world } = setup(0, 0, a);
    expect(world.sampleFloor({ x: 1, y: 1.5 }, 0.003)).toBe(0);
    expect(world.sampleFloor({ x: 1, y: 1.6 }, 0.003)).toBe(1);
    expect(world.sampleFloor({ x: 1, y: 1.5 + 0.009 }, 0.004)).toBeGreaterThan(0); // partly on the edge
    expect(world.sampleFloor({ x: -1, y: -1 }, 0.003)).toBe(1); // outside the arena
  });
});

describe('determinism', () => {
  it('routes planck trig through dmath (patched build)', () => {
    const calls = { sin: 0, cos: 0 };
    const saved = globalThis.__robosimDmath;
    globalThis.__robosimDmath = {
      sin: (x) => (calls.sin++, sin(x)),
      cos: (x) => (calls.cos++, cos(x)),
      atan2: (y, x) => Math.atan2(y, x),
    };
    try {
      const { run } = setup(0.01, 0.03);
      run(0.1);
    } finally {
      globalThis.__robosimDmath = saved;
    }
    expect(calls.sin).toBeGreaterThan(10);
    expect(calls.cos).toBeGreaterThan(10);
  });

  it('identical inputs give bit-identical trajectories', () => {
    const trace = () => {
      const { run, pose } = setup(0.013, 0.027);
      return Array.from({ length: 10 }, () => {
        run(0.2);
        return pose();
      });
    };
    expect(trace()).toEqual(trace());
  });
});
