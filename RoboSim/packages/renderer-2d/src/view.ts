/** Plain view-model types: the renderer never imports engine code (Technical Design §3.1). */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Pose {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
}

/** Floor paint (luminance 0 = black … 1 = white), as in the arena spec. */
export type FloorPaint =
  | {
      readonly kind: 'polyline';
      readonly points: readonly Point[];
      readonly closed?: boolean;
      readonly widthMm: number;
      readonly value: number;
    }
  | { readonly kind: 'rect'; readonly min: Point; readonly max: Point; readonly value: number }
  | { readonly kind: 'circle'; readonly center: Point; readonly radiusM: number; readonly value: number };

export interface ObstacleView {
  readonly id: string;
  readonly shape:
    | { readonly kind: 'box'; readonly widthM: number; readonly heightM: number }
    | { readonly kind: 'circle'; readonly radiusM: number };
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly dynamic: boolean;
}

export interface ArenaView {
  readonly widthM: number;
  readonly heightM: number;
  readonly floor: { readonly background: number; readonly strokes: readonly FloorPaint[] };
  readonly perimeterWalls: boolean;
  readonly obstacles: readonly ObstacleView[];
  readonly zones: readonly {
    readonly id: string;
    readonly kind: string;
    readonly x: number;
    readonly y: number;
    readonly radiusM: number;
  }[];
}

export interface RobotView {
  readonly footprint: readonly Point[];
  readonly wheels: readonly { readonly x: number; readonly y: number; readonly radiusM: number }[];
  readonly caster: Point;
}

export interface RobotPose extends Pose {
  /** Line-sensor spots in world coordinates with their reading (drawn when no overlay is given). */
  readonly sensors?: readonly { readonly x: number; readonly y: number; readonly black: boolean }[];
}

/** Challenge overlay: checkpoints already passed and the zone to reach next. */
export interface ZoneOverlay {
  readonly visitedZones: readonly string[];
  readonly nextZone: string | null;
}

/**
 * Sensor and drive overlay (FR-ARN-07), in world coordinates. Labels come formatted from the
 * caller (locale-aware numbers and units).
 */
export interface SensorOverlay {
  readonly lineSpots: readonly { readonly x: number; readonly y: number; readonly black: boolean }[];
  readonly sonars: readonly {
    readonly x: number;
    readonly y: number;
    readonly angle: number;
    readonly coneRad: number;
    readonly maxM: number;
    /** Measured range, or null for no echo (out of range). */
    readonly distanceM: number | null;
    readonly label: string;
  }[];
  readonly wheels: readonly {
    readonly x: number;
    readonly y: number;
    /** Direction of travel for positive speed. */
    readonly angle: number;
    /** Wheel surface speed (m/s). */
    readonly speedMps: number;
    readonly label: string;
  }[];
}

/** The robot drawn as an editable start pose: tinted when the pose is not allowed. */
export interface PoseHandle {
  readonly pose: Pose;
  readonly valid: boolean;
}

export interface Theme {
  readonly wall: string;
  readonly obstacle: string;
  readonly movable: string;
  readonly zone: string;
  readonly zoneGoal: string;
  readonly zoneVisited: string;
  readonly zoneNext: string;
  readonly body: string;
  readonly bodyStroke: string;
  readonly bodyInvalid: string;
  readonly handle: string;
  readonly wheel: string;
  readonly trail: string;
  readonly sensorOn: string;
  readonly sensorOff: string;
  readonly sonar: string;
  readonly sonarCone: string;
  readonly speed: string;
  readonly label: string;
  readonly labelBg: string;
}

export const DEFAULT_THEME: Theme = {
  wall: '#475569',
  obstacle: '#64748b',
  movable: '#d97706',
  zone: '#0ea5e9',
  zoneGoal: '#16a34a',
  zoneVisited: 'rgba(22, 163, 74, 0.25)',
  zoneNext: '#f59e0b',
  body: '#2563eb',
  bodyStroke: '#1e3a8a',
  bodyInvalid: '#dc2626',
  handle: '#f59e0b',
  wheel: '#111827',
  trail: 'rgba(234, 88, 12, 0.7)',
  sensorOn: '#dc2626',
  sensorOff: '#16a34a',
  sonar: 'rgba(147, 51, 234, 0.85)',
  sonarCone: 'rgba(147, 51, 234, 0.12)',
  speed: '#0891b2',
  label: '#0f172a',
  labelBg: 'rgba(255, 255, 255, 0.85)',
};

/** World (m, y up) → canvas pixels (y down). */
export interface ViewTransform {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly canvasHeight: number;
}

/** What the view looks at: `zoom` 1 = whole arena fitted; `center` null = arena centre. */
export interface Camera {
  readonly zoom: number;
  readonly center: Point | null;
}

export const FIT_CAMERA: Camera = { zoom: 1, center: null };
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 12;

export function fitTransform(
  arena: { widthM: number; heightM: number },
  width: number,
  height: number,
  marginPx = 12,
): ViewTransform {
  const scale = Math.max(
    0,
    Math.min((width - 2 * marginPx) / arena.widthM, (height - 2 * marginPx) / arena.heightM),
  );
  return {
    scale,
    offsetX: (width - arena.widthM * scale) / 2,
    offsetY: (height - arena.heightM * scale) / 2,
    canvasHeight: height,
  };
}

/** The fitted transform, zoomed by the camera and centred on its point. */
export function cameraTransform(
  arena: { widthM: number; heightM: number },
  width: number,
  height: number,
  camera: Camera,
): ViewTransform {
  const fit = fitTransform(arena, width, height);
  const scale = fit.scale * camera.zoom;
  const c = camera.center ?? { x: arena.widthM / 2, y: arena.heightM / 2 };
  return { scale, offsetX: width / 2 - c.x * scale, offsetY: height / 2 - c.y * scale, canvasHeight: height };
}

export function toCanvas(t: ViewTransform, p: Point): Point {
  return { x: t.offsetX + p.x * t.scale, y: t.canvasHeight - (t.offsetY + p.y * t.scale) };
}

export function toWorld(t: ViewTransform, p: Point): Point {
  return { x: (p.x - t.offsetX) / t.scale, y: (t.canvasHeight - p.y - t.offsetY) / t.scale };
}

/** Camera after zooming by `factor` about a canvas point, keeping the world point under it fixed. */
export function zoomAt(
  arena: { widthM: number; heightM: number },
  width: number,
  height: number,
  camera: Camera,
  at: Point,
  factor: number,
): Camera {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.zoom * factor));
  const before = toWorld(cameraTransform(arena, width, height, camera), at);
  const t = cameraTransform(arena, width, height, { ...camera, zoom });
  const after = toWorld(t, at);
  const c = camera.center ?? { x: arena.widthM / 2, y: arena.heightM / 2 };
  return { zoom, center: { x: c.x + before.x - after.x, y: c.y + before.y - after.y } };
}

/** Rotates a robot-frame point (m) by the pose and translates it into the world. */
export function robotToWorld(pose: Pose, p: Point): Point {
  const c = Math.cos(pose.angle);
  const s = Math.sin(pose.angle);
  return { x: pose.x + c * p.x - s * p.y, y: pose.y + s * p.x + c * p.y };
}

/** Where the start-pose rotate handle sits: ahead of the robot's front edge (world m). */
export function handlePoint(robot: RobotView, pose: Pose): Point {
  const front = Math.max(...robot.footprint.map((p) => p.x));
  return robotToWorld(pose, { x: front + 0.06, y: 0 });
}

/** Whether a world point lies on the robot body (its footprint at `pose`). */
export function hitsRobot(robot: RobotView, pose: Pose, p: Point): boolean {
  const pts = robot.footprint.map((q) => robotToWorld(pose, q));
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i] as Point;
    const b = pts[j] as Point;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Heading from the robot towards a point, snapped to `stepRad` when given. */
export function headingTowards(pose: Point, p: Point, stepRad = 0): number {
  const a = Math.atan2(p.y - pose.y, p.x - pose.x);
  return stepRad > 0 ? Math.round(a / stepRad) * stepRad : a;
}
