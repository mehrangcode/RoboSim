import {
  DEFAULT_THEME,
  FIT_CAMERA,
  cameraTransform,
  handlePoint,
  robotToWorld,
  toCanvas,
  type ArenaView,
  type Camera,
  type FloorPaint,
  type ObstacleView,
  type Point,
  type Pose,
  type PoseHandle,
  type RobotPose,
  type RobotView,
  type SensorOverlay,
  type Theme,
  type ViewTransform,
  type ZoneOverlay,
} from './view.js';

const TRAIL_POINTS = 2000;
/** Arrow length per m/s of wheel speed (world m). */
const SPEED_ARROW_M_PER_MPS = 0.3;

export interface DrawState {
  /** Live robot pose; null before the first frame or on the bench. */
  readonly pose?: RobotPose | null;
  readonly zones?: ZoneOverlay | null;
  /** Live poses of pushable obstacles by id (others stay where the arena puts them). */
  readonly obstacles?: Readonly<Record<string, Pose>> | undefined;
  readonly overlay?: SensorOverlay | null;
  /** Draw the path driven so far (it is recorded either way). */
  readonly trail?: boolean;
  /** Start-pose editing: the robot drawn at the pose with a rotate handle. */
  readonly handle?: PoseHandle | null;
}

/**
 * Top-down Canvas 2D view of an arena and robot (FR-ARN-07). Display-only: Math.cos/sin here are
 * fine because nothing flows back into the simulation.
 */
export class ArenaRenderer {
  private camera: Camera = FIT_CAMERA;
  private transform: ViewTransform;
  private readonly trail: Point[] = [];

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    private readonly arena: ArenaView,
    private readonly robot: RobotView | null,
    private readonly theme: Theme = DEFAULT_THEME,
  ) {
    this.transform = this.computeTransform();
  }

  /** Current world → canvas transform (for pointer hit-testing). */
  get view(): ViewTransform {
    return this.transform;
  }

  /** Call after changing the canvas size (CSS px × devicePixelRatio). */
  resize(): void {
    this.transform = this.computeTransform();
  }

  setCamera(camera: Camera): void {
    this.camera = camera;
    this.transform = this.computeTransform();
  }

  clearTrail(): void {
    this.trail.length = 0;
  }

  draw(state: DrawState = {}): void {
    const { ctx, transform: t } = this;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    this.drawFloor(t);
    this.drawZones(t, state.zones ?? null);
    this.drawObstacles(t, state.obstacles);
    if (this.arena.perimeterWalls) {
      ctx.strokeStyle = this.theme.wall;
      ctx.lineWidth = Math.max(2, 0.01 * t.scale);
      const a = toCanvas(t, { x: 0, y: 0 });
      const b = toCanvas(t, { x: this.arena.widthM, y: this.arena.heightM });
      ctx.strokeRect(a.x, b.y, b.x - a.x, a.y - b.y);
    }
    const pose = state.pose ?? null;
    if (pose) this.recordTrail(pose);
    if (state.trail !== false) this.drawTrail(t);
    if (this.robot && state.handle) {
      this.drawRobot(t, this.robot, state.handle.pose, state.handle.valid ? null : this.theme.bodyInvalid);
      this.drawHandle(t, this.robot, state.handle.pose);
    } else if (this.robot && pose) {
      this.drawRobot(t, this.robot, pose, null);
      if (state.overlay) this.drawOverlay(t, state.overlay, pose);
      else this.drawSensorSpots(t, pose.sensors ?? []);
    }
    ctx.restore();
  }

  private computeTransform(): ViewTransform {
    return cameraTransform(this.arena, this.ctx.canvas.width, this.ctx.canvas.height, this.camera);
  }

  private shade(v: number): string {
    const c = Math.round(Math.min(1, Math.max(0, v)) * 255);
    return `rgb(${c}, ${c}, ${c})`;
  }

  /** Paints the floor from its vectors, like the physics raster but crisp at any zoom. */
  private drawFloor(t: ViewTransform): void {
    const { ctx } = this;
    const { floor } = this.arena;
    const tl = toCanvas(t, { x: 0, y: this.arena.heightM });
    ctx.fillStyle = this.shade(floor.background);
    ctx.fillRect(tl.x, tl.y, this.arena.widthM * t.scale, this.arena.heightM * t.scale);
    for (const s of floor.strokes) this.paint(t, s);
  }

  private paint(t: ViewTransform, s: FloorPaint): void {
    const { ctx } = this;
    const color = this.shade(s.value);
    if (s.kind === 'rect') {
      const a = toCanvas(t, { x: s.min.x, y: s.max.y });
      ctx.fillStyle = color;
      ctx.fillRect(a.x, a.y, (s.max.x - s.min.x) * t.scale, (s.max.y - s.min.y) * t.scale);
    } else if (s.kind === 'circle') {
      const c = toCanvas(t, s.center);
      ctx.beginPath();
      ctx.arc(c.x, c.y, s.radiusM * t.scale, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      ctx.beginPath();
      s.points.forEach((p, i) => {
        const c = toCanvas(t, p);
        if (i === 0) ctx.moveTo(c.x, c.y);
        else ctx.lineTo(c.x, c.y);
      });
      if (s.closed) ctx.closePath();
      ctx.strokeStyle = color;
      ctx.lineWidth = (s.widthMm / 1000) * t.scale;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
  }

  private drawObstacles(t: ViewTransform, live: Readonly<Record<string, Pose>> | undefined): void {
    const { ctx, theme } = this;
    for (const o of this.arena.obstacles) {
      const pose = (o.dynamic ? live?.[o.id] : undefined) ?? o;
      ctx.fillStyle = o.dynamic ? theme.movable : theme.obstacle;
      ctx.strokeStyle = theme.wall;
      ctx.lineWidth = 1;
      this.obstaclePath(t, o, pose);
      ctx.fill();
      ctx.stroke();
    }
  }

  private obstaclePath(t: ViewTransform, o: ObstacleView, pose: Pose): void {
    const { ctx } = this;
    ctx.beginPath();
    if (o.shape.kind === 'circle') {
      const c = toCanvas(t, pose);
      ctx.arc(c.x, c.y, o.shape.radiusM * t.scale, 0, 2 * Math.PI);
      return;
    }
    const hw = o.shape.widthM / 2;
    const hh = o.shape.heightM / 2;
    [
      { x: -hw, y: -hh },
      { x: hw, y: -hh },
      { x: hw, y: hh },
      { x: -hw, y: hh },
    ].forEach((p, i) => {
      const c = toCanvas(t, robotToWorld(pose, p));
      if (i === 0) ctx.moveTo(c.x, c.y);
      else ctx.lineTo(c.x, c.y);
    });
    ctx.closePath();
  }

  private drawZones(t: ViewTransform, overlay: ZoneOverlay | null): void {
    const { ctx, theme } = this;
    for (const z of this.arena.zones) {
      if (z.kind === 'area') continue; // painted on the floor (the sumo ring)
      const c = toCanvas(t, z);
      const visited = overlay?.visitedZones.includes(z.id) ?? false;
      const next = overlay?.nextZone === z.id;
      ctx.beginPath();
      ctx.arc(c.x, c.y, z.radiusM * t.scale, 0, 2 * Math.PI);
      if (visited) {
        ctx.fillStyle = theme.zoneVisited;
        ctx.fill();
      }
      ctx.setLineDash(next ? [] : [6, 4]);
      ctx.lineWidth = next ? 3 : 1.5;
      ctx.strokeStyle = next ? theme.zoneNext : z.kind === 'goal' ? theme.zoneGoal : theme.zone;
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  private recordTrail(pose: RobotPose): void {
    const last = this.trail.at(-1);
    if (last && Math.hypot(last.x - pose.x, last.y - pose.y) < 0.005) return;
    this.trail.push({ x: pose.x, y: pose.y });
    if (this.trail.length > TRAIL_POINTS) this.trail.shift();
  }

  private drawTrail(t: ViewTransform): void {
    if (this.trail.length < 2) return;
    const { ctx } = this;
    ctx.strokeStyle = this.theme.trail;
    ctx.lineWidth = 2;
    ctx.beginPath();
    this.trail.forEach((p, i) => {
      const c = toCanvas(t, p);
      if (i === 0) ctx.moveTo(c.x, c.y);
      else ctx.lineTo(c.x, c.y);
    });
    ctx.stroke();
  }

  private drawRobot(t: ViewTransform, robot: RobotView, pose: Pose, tint: string | null): void {
    const { ctx, theme } = this;
    const poly = (pts: readonly Point[]): void => {
      ctx.beginPath();
      pts.forEach((p, i) => {
        const c = toCanvas(t, robotToWorld(pose, p));
        if (i === 0) ctx.moveTo(c.x, c.y);
        else ctx.lineTo(c.x, c.y);
      });
      ctx.closePath();
    };
    poly(robot.footprint);
    ctx.fillStyle = tint ?? theme.body;
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = tint ?? theme.bodyStroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = theme.wheel;
    for (const w of robot.wheels) {
      const halfW = 0.013;
      poly([
        { x: w.x - w.radiusM, y: w.y - halfW },
        { x: w.x + w.radiusM, y: w.y - halfW },
        { x: w.x + w.radiusM, y: w.y + halfW },
        { x: w.x - w.radiusM, y: w.y + halfW },
      ]);
      ctx.fill();
    }
    const caster = toCanvas(t, robotToWorld(pose, robot.caster));
    ctx.beginPath();
    ctx.arc(caster.x, caster.y, Math.max(2, 0.01 * t.scale), 0, 2 * Math.PI);
    ctx.fill();

    // Heading arrow from the axle midpoint.
    const front = Math.max(...robot.footprint.map((p) => p.x));
    const from = toCanvas(t, robotToWorld(pose, { x: 0, y: 0 }));
    const to = toCanvas(t, robotToWorld(pose, { x: front * 0.8, y: 0 }));
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }

  private drawHandle(t: ViewTransform, robot: RobotView, pose: Pose): void {
    const { ctx, theme } = this;
    const front = Math.max(...robot.footprint.map((p) => p.x));
    const edge = toCanvas(t, robotToWorld(pose, { x: front, y: 0 }));
    const h = toCanvas(t, handlePoint(robot, pose));
    ctx.strokeStyle = theme.handle;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(edge.x, edge.y);
    ctx.lineTo(h.x, h.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(h.x, h.y, 7, 0, 2 * Math.PI);
    ctx.fillStyle = theme.handle;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  }

  private drawSensorSpots(
    t: ViewTransform,
    spots: readonly { x: number; y: number; black: boolean }[],
  ): void {
    const { ctx, theme } = this;
    for (const s of spots) {
      const c = toCanvas(t, s);
      ctx.beginPath();
      ctx.arc(c.x, c.y, Math.max(3, 0.006 * t.scale), 0, 2 * Math.PI);
      ctx.fillStyle = s.black ? theme.sensorOn : theme.sensorOff;
      ctx.fill();
    }
  }

  private drawOverlay(t: ViewTransform, overlay: SensorOverlay, pose: Pose): void {
    const { ctx, theme } = this;
    this.drawSensorSpots(t, overlay.lineSpots);
    for (const s of overlay.sonars) {
      const o = toCanvas(t, s);
      const reach = s.distanceM ?? s.maxM;
      ctx.beginPath();
      ctx.moveTo(o.x, o.y);
      for (const k of [-0.5, 0.5]) {
        const p = toCanvas(t, {
          x: s.x + Math.cos(s.angle + k * s.coneRad) * reach,
          y: s.y + Math.sin(s.angle + k * s.coneRad) * reach,
        });
        ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.fillStyle = theme.sonarCone;
      ctx.fill();
      ctx.strokeStyle = theme.sonar;
      ctx.lineWidth = 1;
      ctx.setLineDash(s.distanceM === null ? [4, 4] : []);
      const hit = toCanvas(t, { x: s.x + Math.cos(s.angle) * reach, y: s.y + Math.sin(s.angle) * reach });
      ctx.beginPath();
      ctx.moveTo(o.x, o.y);
      ctx.lineTo(hit.x, hit.y);
      ctx.stroke();
      ctx.setLineDash([]);
      if (s.distanceM !== null) {
        ctx.beginPath();
        ctx.arc(hit.x, hit.y, 4, 0, 2 * Math.PI);
        ctx.fillStyle = theme.sonar;
        ctx.fill();
      }
      this.label(s.label, hit.x, hit.y - 10);
    }
    for (const w of overlay.wheels) {
      const from = toCanvas(t, w);
      const len = w.speedMps * SPEED_ARROW_M_PER_MPS;
      const to = toCanvas(t, { x: w.x + Math.cos(w.angle) * len, y: w.y + Math.sin(w.angle) * len });
      ctx.strokeStyle = theme.speed;
      ctx.fillStyle = theme.speed;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      const dir = Math.atan2(to.y - from.y, to.x - from.x);
      if (Math.hypot(to.x - from.x, to.y - from.y) > 6) {
        ctx.beginPath();
        ctx.moveTo(to.x, to.y);
        ctx.lineTo(to.x - 8 * Math.cos(dir - 0.4), to.y - 8 * Math.sin(dir - 0.4));
        ctx.lineTo(to.x - 8 * Math.cos(dir + 0.4), to.y - 8 * Math.sin(dir + 0.4));
        ctx.closePath();
        ctx.fill();
      }
      // Labels sit outside the wheel, away from the body, so the two wheels never overlap.
      const centre = toCanvas(t, pose);
      const dx = from.x - centre.x;
      const dy = from.y - centre.y;
      const d = Math.hypot(dx, dy) || 1;
      this.label(w.label, from.x + (dx / d) * 26, from.y + (dy / d) * 26);
    }
  }

  private label(text: string, x: number, y: number): void {
    if (!text) return;
    const { ctx, theme } = this;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + 6;
    ctx.fillStyle = theme.labelBg;
    ctx.fillRect(x - w / 2, y - 8, w, 16);
    ctx.fillStyle = theme.label;
    ctx.fillText(text, x, y);
  }
}
