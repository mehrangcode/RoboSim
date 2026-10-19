import type { Body } from 'planck';
import { Box, Circle, Edge, FrictionJoint, Polygon, World, Vec2 as PVec2 } from 'planck';
import {
  isWheelActuator,
  type BodySnapshot,
  type ComponentModel,
  type ComponentPose,
  type RayHit,
  type Vec2,
  type WheelActuator,
  type WorldModel,
} from '../contracts.js';
import { atan2, cos, sin } from '../dmath/index.js';
import { floorAt, rasterizeFloor, type FloorRaster } from './floor.js';
import { robotMass } from './mass.js';
import { DEFAULT_PHYSICS, type ArenaSpec, type PhysicsParams, type RobotSpec } from './types.js';

declare global {
  // Read by the patched planck build (patches/planck@1.5.0.patch, ADR-021) on every trig call.
  var __robosimDmath:
    { sin(x: number): number; cos(x: number): number; atan2(y: number, x: number): number } | undefined;
}
globalThis.__robosimDmath = { sin, cos, atan2 };

const VELOCITY_ITERATIONS = 8;
const POSITION_ITERATIONS = 3;
/** Speeds below this (m/s) blend friction to zero instead of flipping sign every step. */
const FRICTION_DEADBAND_M_S = 0.01;
const FLOOR_SAMPLES = 8;
const FLOOR_SAMPLE_RADIUS = 0.7;
/**
 * planck keeps polygons and edges apart by a contact skin (Settings.polygonRadius = 2 × linearSlop =
 * 1 cm each), so two boxes would rest 2 cm apart. Polygons are inset and the perimeter moved out by the
 * skin, so bodies touch at their true outlines; ray casts add the skin back (see `raycast`).
 */
const SKIN_M = 0.01;

interface Wheel {
  readonly side: 'left' | 'right';
  readonly local: PVec2;
  readonly radius: number;
  readonly normalForce: number;
  actuator: WheelActuator | null;
}

interface Robot {
  readonly spec: RobotSpec;
  readonly body: Body;
  readonly wheels: readonly Wheel[];
  readonly caster: { readonly local: PVec2; readonly normalForce: number };
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const blend = (v: number): number => clamp(v / FRICTION_DEADBAND_M_S, -1, 1);

/**
 * planck.js arena (Technical Design §5.5): top-down, zero gravity in the plane. Each drive wheel
 * pushes with F = τ / r at its mount point (capped by traction μ·N), a lateral impulse cancels
 * sideways slip up to μ·N, rolling resistance and a low-friction caster oppose motion. After every
 * step the wheel ground speed is fed back to its motor (no-slip coupling) for the back-EMF.
 */
export class PlanckWorld implements WorldModel {
  readonly floor: FloorRaster;
  private readonly world: World;
  private readonly robots: Robot[] = [];
  private readonly dynamicObstacles: { readonly id: string; readonly body: Body }[] = [];
  /** New contacts between each robot and anything that is not itself (walls, obstacles, other robots). */
  private readonly collisions = new Map<string, number>();

  constructor(
    readonly arena: ArenaSpec,
    robots: readonly RobotSpec[],
    private readonly params: PhysicsParams = DEFAULT_PHYSICS,
  ) {
    this.world = new World({ gravity: new PVec2(0, 0) });
    this.floor = rasterizeFloor(arena.floor, arena.widthM, arena.heightM);
    const ground = this.world.createBody({ type: 'static' });
    if (arena.perimeterWalls !== false) this.addPerimeter(ground);
    for (const o of arena.obstacles ?? []) this.addObstacle(o, ground);
    for (const r of robots) this.robots.push(this.addRobot(r));
    this.world.on('begin-contact', (contact) => {
      const a = (contact.getFixtureA().getBody().getUserData() as { id?: string } | null)?.id;
      const b = (contact.getFixtureB().getBody().getUserData() as { id?: string } | null)?.id;
      for (const r of this.robots) {
        const id = r.spec.id;
        if ((a === id) !== (b === id)) this.collisions.set(id, (this.collisions.get(id) ?? 0) + 1);
      }
    });
  }

  /** Number of contacts the robot has started with walls, obstacles or other robots so far. */
  collisionCount(robotId: string): number {
    return this.collisions.get(robotId) ?? 0;
  }

  /**
   * Whether the line runs under the robot: any black floor (luminance < 0.5) on the segment across the
   * axle midpoint, ±`toleranceMm` along the robot's lateral axis. Independent of mounted sensors.
   */
  isOnLine(robotId: string, toleranceMm = 25): boolean {
    const r = this.robots.find((x) => x.spec.id === robotId);
    if (!r) throw new Error(`Unknown robot '${robotId}'`);
    const steps = Math.max(1, Math.round(toleranceMm / 2.5));
    for (let i = -steps; i <= steps; i++) {
      const p = r.body.getWorldPoint(new PVec2(0, (i * toleranceMm) / steps / 1000));
      if (floorAt(this.floor, { x: p.x, y: p.y }) < 0.5) return true;
    }
    return false;
  }

  bind(lookup: (componentId: string) => ComponentModel | undefined): void {
    for (const robot of this.robots) {
      for (const wheel of robot.wheels) {
        const id = wheel.side === 'left' ? robot.spec.drives.left : robot.spec.drives.right;
        const model = lookup(id);
        if (!isWheelActuator(model))
          throw new Error(`Robot '${robot.spec.id}': '${id}' cannot drive a wheel`);
        wheel.actuator = model;
      }
      this.applyReflectedInertia(robot);
    }
  }

  step(dt: number): void {
    for (const robot of this.robots) this.applyDrivetrain(robot, dt);
    this.world.step(dt, VELOCITY_ITERATIONS, POSITION_ITERATIONS);
    for (const robot of this.robots) {
      for (const wheel of robot.wheels) {
        const forward = robot.body.getWorldVector(new PVec2(1, 0));
        const v = robot.body.getLinearVelocityFromLocalPoint(wheel.local);
        wheel.actuator?.setShaftSpeed((v.x * forward.x + v.y * forward.y) / wheel.radius);
      }
    }
  }

  raycast(origin: Vec2, dir: Vec2, maxDist: number): RayHit | null {
    let best: RayHit | null = null;
    const p1 = new PVec2(origin.x, origin.y);
    const p2 = new PVec2(origin.x + dir.x * maxDist, origin.y + dir.y * maxDist);
    this.world.rayCast(p1, p2, (fixture, _point, normal, fraction) => {
      // Polygons and edges sit one skin inside their true outline: measure to the outline.
      const skinned = fixture.getShape().getType() !== 'circle';
      const incidence = Math.max(0.2, Math.abs(normal.x * dir.x + normal.y * dir.y));
      const distance = Math.max(0, fraction * maxDist - (skinned ? SKIN_M / incidence : 0));
      if (distance <= maxDist && (!best || distance < best.distance)) {
        const data = fixture.getBody().getUserData() as { id?: string } | null;
        const point = { x: origin.x + dir.x * distance, y: origin.y + dir.y * distance };
        best = { point, distance, bodyId: data?.id ?? 'wall' };
      }
      return 1; // keep looking: a skinned polygon just behind a circle may be nearer once corrected
    });
    return best;
  }

  sampleFloor(p: Vec2, radius: number): number {
    let sum = floorAt(this.floor, p);
    for (let k = 0; k < FLOOR_SAMPLES; k++) {
      const a = (2 * Math.PI * k) / FLOOR_SAMPLES;
      sum += floorAt(this.floor, {
        x: p.x + FLOOR_SAMPLE_RADIUS * radius * cos(a),
        y: p.y + FLOOR_SAMPLE_RADIUS * radius * sin(a),
      });
    }
    return sum / (FLOOR_SAMPLES + 1);
  }

  bodies(): readonly BodySnapshot[] {
    const snap = (id: string, body: Body): BodySnapshot => {
      const p = body.getPosition();
      return { id, position: { x: p.x, y: p.y }, angle: body.getAngle() };
    };
    return [
      ...this.robots.map((r) => snap(r.spec.id, r.body)),
      ...this.dynamicObstacles.map((o) => snap(o.id, o.body)),
    ];
  }

  componentPose(componentId: string): ComponentPose | null {
    for (const r of this.robots) {
      const m = r.spec.mounts[componentId];
      if (!m) continue;
      const p = r.body.getWorldPoint(new PVec2(m.xMm / 1000, m.yMm / 1000));
      return {
        position: { x: p.x, y: p.y },
        angle: r.body.getAngle() + (m.angle ?? 0),
        heightMm: m.heightMm,
      };
    }
    return null;
  }

  componentMotion(componentId: string): { velocity: Vec2; yawRate: number } | null {
    for (const r of this.robots) {
      const m = r.spec.mounts[componentId];
      if (!m) continue;
      const v = r.body.getLinearVelocityFromLocalPoint(new PVec2(m.xMm / 1000, m.yMm / 1000));
      return { velocity: { x: v.x, y: v.y }, yawRate: r.body.getAngularVelocity() };
    }
    return null;
  }

  /** Robot chassis velocity in the robot frame (forward m/s, yaw rad/s) for tests and telemetry. */
  robotMotion(robotId: string): { forward: number; lateral: number; yawRate: number } {
    const r = this.robots.find((x) => x.spec.id === robotId);
    if (!r) throw new Error(`Unknown robot '${robotId}'`);
    const v = r.body.getLinearVelocityFromLocalPoint(new PVec2(0, 0));
    const f = r.body.getWorldVector(new PVec2(1, 0));
    const l = r.body.getWorldVector(new PVec2(0, 1));
    return {
      forward: v.x * f.x + v.y * f.y,
      lateral: v.x * l.x + v.y * l.y,
      yawRate: r.body.getAngularVelocity(),
    };
  }

  private applyDrivetrain(robot: Robot, dt: number): void {
    const { body } = robot;
    const { wheelFriction, wheelRollingResistance, casterFriction } = this.params;
    const forward = body.getWorldVector(new PVec2(1, 0));
    const lateral = body.getWorldVector(new PVec2(0, 1));
    for (const wheel of robot.wheels) {
      const point = body.getWorldPoint(wheel.local);
      const v = body.getLinearVelocityFromLocalPoint(wheel.local);
      const vLong = v.x * forward.x + v.y * forward.y;
      const traction = wheelFriction * wheel.normalForce;
      const drive = clamp((wheel.actuator?.shaftTorque() ?? 0) / wheel.radius, -traction, traction);
      const rolling = -wheelRollingResistance * wheel.normalForce * blend(vLong);
      body.applyForce(new PVec2(forward.x * (drive + rolling), forward.y * (drive + rolling)), point, true);

      // Lateral grip: impulse that cancels sideways slip at the contact, limited by μ·N·dt.
      const vLat = v.x * lateral.x + v.y * lateral.y;
      const r = PVec2.sub(point, body.getWorldCenter());
      const rCrossN = r.x * lateral.y - r.y * lateral.x;
      const effMass = 1 / (1 / body.getMass() + (rCrossN * rCrossN) / body.getInertia());
      const maxImpulse = wheelFriction * wheel.normalForce * dt;
      const j = clamp(-vLat * effMass, -maxImpulse, maxImpulse);
      body.applyLinearImpulse(new PVec2(lateral.x * j, lateral.y * j), point, true);
    }
    // Swivel caster: friction opposing the contact velocity in whatever direction it points.
    const cPoint = body.getWorldPoint(robot.caster.local);
    const cv = body.getLinearVelocityFromLocalPoint(robot.caster.local);
    const speed = Math.sqrt(cv.x * cv.x + cv.y * cv.y);
    if (speed > 0) {
      const f = (casterFriction * robot.caster.normalForce * blend(speed)) / speed;
      body.applyForce(new PVec2(-cv.x * f, -cv.y * f), cPoint, true);
    }
  }

  private addRobot(spec: RobotSpec): Robot {
    const g = spec.geometry;
    const body = this.world.createBody({
      type: 'dynamic',
      position: new PVec2(spec.start.x, spec.start.y),
      angle: spec.start.angle,
      bullet: true,
    });
    body.setUserData({ id: spec.id });
    body.createFixture({
      shape: new Polygon(insetConvex(g.footprint, SKIN_M).map((p) => new PVec2(p.x, p.y))),
      density: 1,
      friction: 0.3,
    });

    const mass = robotMass(g, spec.payload);
    body.setMassData({
      mass: mass.massKg,
      center: new PVec2(mass.center.x, mass.center.y),
      I: mass.inertiaKgM2,
    });

    // Static load split between the drive axle (x = 0) and the caster by the lever rule.
    const weight = mass.massKg * this.params.gravity;
    const axleShare = mass.axleShare;
    const wheels: Wheel[] = g.wheels.map((w) => ({
      side: w.side,
      local: new PVec2(w.position.x, w.position.y),
      radius: w.radiusM,
      normalForce: (weight * axleShare) / g.wheels.length,
      actuator: null,
    }));
    return {
      spec,
      body,
      wheels,
      caster: { local: new PVec2(g.caster.x, g.caster.y), normalForce: weight * (1 - axleShare) },
    };
  }

  /** Gearbox + rotor inertia behaves like extra mass J/r² at each wheel (and yaw inertia at its track). */
  private applyReflectedInertia(robot: Robot): void {
    const data = { mass: 0, center: new PVec2(0, 0), I: 0 };
    robot.body.getMassData(data);
    let mass = data.mass;
    let inertia = data.I;
    for (const w of robot.wheels) {
      const m = (w.actuator?.shaftInertia ?? 0) / (w.radius * w.radius);
      mass += m;
      inertia += m * (w.local.x * w.local.x + w.local.y * w.local.y);
    }
    robot.body.setMassData({ mass, center: data.center, I: inertia });
  }

  private addPerimeter(ground: Body): void {
    const { widthM: w, heightM: h } = this.arena;
    const s = SKIN_M;
    const corners = [new PVec2(-s, -s), new PVec2(w + s, -s), new PVec2(w + s, h + s), new PVec2(-s, h + s)];
    corners.forEach((a, i) =>
      ground.createFixture({ shape: new Edge(a, corners[(i + 1) % 4] ?? a), friction: 0.3 }),
    );
  }

  private addObstacle(
    o: ArenaSpec['obstacles'] extends readonly (infer T)[] | undefined ? T : never,
    ground: Body,
  ): void {
    const shape =
      o.shape.kind === 'box'
        ? new Box(Math.max(o.shape.widthM / 2 - SKIN_M, 1e-3), Math.max(o.shape.heightM / 2 - SKIN_M, 1e-3))
        : new Circle(o.shape.radiusM);
    const body = this.world.createBody({
      type: o.dynamic ? 'dynamic' : 'static',
      position: new PVec2(o.pose.x, o.pose.y),
      angle: o.pose.angle,
    });
    body.setUserData({ id: o.id });
    body.createFixture({ shape, density: 1, friction: 0.3 });
    if (!o.dynamic) return;
    const mass = o.massKg ?? 0.2;
    const md = { mass: 0, center: new PVec2(0, 0), I: 0 };
    body.getMassData(md);
    body.setMassData({ mass, center: md.center, I: md.I * (mass / Math.max(md.mass, 1e-9)) });
    // Top-down floor friction: a friction joint to the ground body (planck's recommended pattern).
    const maxForce = this.params.obstacleFloorFriction * mass * this.params.gravity;
    this.world.createJoint(
      new FrictionJoint({ maxForce, maxTorque: maxForce * 0.05 }, ground, body, body.getWorldCenter()),
    );
    this.dynamicObstacles.push({ id: o.id, body });
  }
}

/** Moves every edge of a convex polygon inward by `d` (vertices along their bisectors). */
function insetConvex(points: readonly { x: number; y: number }[], d: number): { x: number; y: number }[] {
  const n = points.length;
  // Signed area tells the winding, so "inward" is the right side of each edge either way.
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i] as { x: number; y: number };
    const b = points[(i + 1) % n] as { x: number; y: number };
    area += a.x * b.y - b.x * a.y;
  }
  const sign = area >= 0 ? 1 : -1;
  const normal = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.hypot(ex, ey) || 1;
    return { x: (-ey / len) * sign, y: (ex / len) * sign };
  };
  return points.map((p, i) => {
    const prev = points[(i + n - 1) % n] as { x: number; y: number };
    const next = points[(i + 1) % n] as { x: number; y: number };
    const n1 = normal(prev, p);
    const n2 = normal(p, next);
    const k = d / (1 + n1.x * n2.x + n1.y * n2.y);
    return { x: p.x + (n1.x + n2.x) * k, y: p.y + (n1.y + n2.y) * k };
  });
}
