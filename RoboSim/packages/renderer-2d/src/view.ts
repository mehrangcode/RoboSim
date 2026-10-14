/** Plain view-model types: the renderer never imports engine code (Technical Design §3.1). */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface ArenaView {
  readonly widthM: number;
  readonly heightM: number;
  readonly floor: { readonly widthPx: number; readonly heightPx: number; readonly data: Uint8Array };
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

export interface RobotPose {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly sensors: readonly { readonly x: number; readonly y: number; readonly black: boolean }[];
}

/** Challenge overlay: checkpoints already passed and the one to reach next. */
export interface ZoneOverlay {
  readonly visitedZones: readonly string[];
  readonly nextZone: string | null;
}

export interface Theme {
  readonly wall: string;
  readonly zone: string;
  readonly zoneVisited: string;
  readonly zoneNext: string;
  readonly body: string;
  readonly bodyStroke: string;
  readonly wheel: string;
  readonly trail: string;
  readonly sensorOn: string;
  readonly sensorOff: string;
}

export const DEFAULT_THEME: Theme = {
  wall: '#475569',
  zone: '#0ea5e9',
  zoneVisited: 'rgba(22, 163, 74, 0.25)',
  zoneNext: '#f59e0b',
  body: '#2563eb',
  bodyStroke: '#1e3a8a',
  wheel: '#111827',
  trail: 'rgba(234, 88, 12, 0.7)',
  sensorOn: '#dc2626',
  sensorOff: '#16a34a',
};

/** World (m, y up) → canvas pixels (y down), fitted and centred with a margin. */
export interface ViewTransform {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly canvasHeight: number;
}

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

export function toCanvas(t: ViewTransform, p: Point): Point {
  return { x: t.offsetX + p.x * t.scale, y: t.canvasHeight - (t.offsetY + p.y * t.scale) };
}

/** Rotates a robot-frame point (m) by the pose and translates it into the world. */
export function robotToWorld(pose: { x: number; y: number; angle: number }, p: Point): Point {
  const c = Math.cos(pose.angle);
  const s = Math.sin(pose.angle);
  return { x: pose.x + c * p.x - s * p.y, y: pose.y + s * p.x + c * p.y };
}
