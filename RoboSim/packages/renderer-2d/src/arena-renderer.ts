import {
  DEFAULT_THEME,
  fitTransform,
  robotToWorld,
  toCanvas,
  type ArenaView,
  type Point,
  type RobotPose,
  type RobotView,
  type Theme,
  type ViewTransform,
  type ZoneOverlay,
} from './view.js';

const TRAIL_POINTS = 900;

/**
 * Top-down Canvas 2D view of an arena and robot (Release Plan P1 "2D renderer"). Display-only:
 * Math.cos/sin here are fine because nothing flows back into the simulation.
 */
export class ArenaRenderer {
  private floorImage: OffscreenCanvas | HTMLCanvasElement | null = null;
  private transform: ViewTransform;
  private readonly trail: Point[] = [];

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    private readonly arena: ArenaView,
    private readonly robot: RobotView | null,
    private readonly theme: Theme = DEFAULT_THEME,
  ) {
    this.transform = fitTransform(arena, ctx.canvas.width, ctx.canvas.height);
  }

  /** Call after changing the canvas size (CSS px × devicePixelRatio). */
  resize(): void {
    this.transform = fitTransform(this.arena, this.ctx.canvas.width, this.ctx.canvas.height);
  }

  clearTrail(): void {
    this.trail.length = 0;
  }

  draw(pose: RobotPose | null, overlay: ZoneOverlay | null = null): void {
    const { ctx, transform: t } = this;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    this.drawFloor(t);
    this.drawZones(t, overlay);
    ctx.strokeStyle = this.theme.wall;
    ctx.lineWidth = Math.max(2, 0.01 * t.scale);
    const a = toCanvas(t, { x: 0, y: 0 });
    const b = toCanvas(t, { x: this.arena.widthM, y: this.arena.heightM });
    ctx.strokeRect(a.x, b.y, b.x - a.x, a.y - b.y);
    if (pose && this.robot) {
      this.recordTrail(pose);
      this.drawTrail(t);
      this.drawRobot(t, this.robot, pose);
    }
    ctx.restore();
  }

  private drawFloor(t: ViewTransform): void {
    const { floor } = this.arena;
    if (!this.floorImage) {
      const img = new ImageData(floor.widthPx, floor.heightPx);
      // Raster row 0 is the arena bottom; image row 0 is the top.
      for (let y = 0; y < floor.heightPx; y++) {
        const src = (floor.heightPx - 1 - y) * floor.widthPx;
        for (let x = 0; x < floor.widthPx; x++) {
          const v = floor.data[src + x] ?? 255;
          const o = (y * floor.widthPx + x) * 4;
          img.data[o] = v;
          img.data[o + 1] = v;
          img.data[o + 2] = v;
          img.data[o + 3] = 255;
        }
      }
      const canvas =
        typeof OffscreenCanvas === 'function'
          ? new OffscreenCanvas(floor.widthPx, floor.heightPx)
          : document.createElement('canvas');
      canvas.width = floor.widthPx;
      canvas.height = floor.heightPx;
      (
        canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
      )?.putImageData(img, 0, 0);
      this.floorImage = canvas;
    }
    const tl = toCanvas(t, { x: 0, y: this.arena.heightM });
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.drawImage(
      this.floorImage,
      tl.x,
      tl.y,
      this.arena.widthM * t.scale,
      this.arena.heightM * t.scale,
    );
  }

  private drawZones(t: ViewTransform, overlay: ZoneOverlay | null): void {
    const { ctx, theme } = this;
    for (const z of this.arena.zones) {
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
      ctx.strokeStyle = next ? theme.zoneNext : theme.zone;
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

  private drawRobot(t: ViewTransform, robot: RobotView, pose: RobotPose): void {
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
    ctx.fillStyle = theme.body;
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = theme.bodyStroke;
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

    for (const s of pose.sensors) {
      const c = toCanvas(t, s);
      ctx.beginPath();
      ctx.arc(c.x, c.y, Math.max(3, 0.006 * t.scale), 0, 2 * Math.PI);
      ctx.fillStyle = s.black ? theme.sensorOn : theme.sensorOff;
      ctx.fill();
    }
  }
}
