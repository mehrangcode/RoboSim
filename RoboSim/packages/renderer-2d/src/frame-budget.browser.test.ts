import { BUILTIN_ARENAS, type BuiltinArena } from '@robosim/content/arenas';
import { describe, expect, it } from 'vitest';
import { ArenaRenderer } from './arena-renderer.js';
import {
  FIT_CAMERA,
  type ArenaView,
  type Camera,
  type RobotPose,
  type RobotView,
  type SensorOverlay,
} from './view.js';

/*
 * 2D frame budget (Technical Design §17: < 8 ms) in headless Chromium and Firefox: every built-in arena in
 * its heaviest state — a 900 × 600 CSS px canvas at devicePixelRatio 2, the full 2000-point trail, zone
 * progress and the sensor/wheel overlay with labels. Each timed frame ends with a 1-pixel readback so the
 * rasterisation is paid inside the frame, not deferred to the next one. Gated on the mean (timed over the
 * whole batch: Firefox rounds performance.now() to 1 ms) and the per-frame p95 (jank). ROBOSIM_PERF_SCALE (via the
 * browser config's `define`) scales the budget for machines slower than the reference.
 */

declare const __PERF_SCALE__: number;
const BUDGET_MS = 8 * __PERF_SCALE__;
const WARMUP = 10;
const FRAMES = 60;

const view = ({ spec: s }: BuiltinArena): ArenaView => ({
  widthM: s.widthM,
  heightM: s.heightM,
  floor: s.floor,
  perimeterWalls: s.perimeterWalls !== false,
  obstacles: (s.obstacles ?? []).map((o) => ({
    id: o.id,
    shape: o.shape,
    ...o.pose,
    dynamic: o.dynamic === true,
  })),
  zones: (s.zones ?? []).map((z) => ({ id: z.id, kind: z.kind, ...z.center, radiusM: z.radiusM })),
});

/** The default 2WD chassis outline (160 × 120 mm, 65 mm wheels). */
const ROBOT: RobotView = {
  footprint: [
    { x: 0.1, y: -0.06 },
    { x: 0.1, y: 0.06 },
    { x: -0.06, y: 0.06 },
    { x: -0.06, y: -0.06 },
  ],
  wheels: [
    { x: 0, y: 0.07, radiusM: 0.0325 },
    { x: 0, y: -0.07, radiusM: 0.0325 },
  ],
  caster: { x: -0.045, y: 0 },
};

/** The robot laps an ellipse inside the arena; step i of n. */
function poseAt(a: ArenaView, i: number, n: number): RobotPose {
  const th = (2 * Math.PI * i) / n;
  const x = a.widthM / 2 + Math.cos(th) * a.widthM * 0.35;
  const y = a.heightM / 2 + Math.sin(th) * a.heightM * 0.35;
  const sensors = [-2, -1, 0, 1, 2].map((k) => ({ x: x + k * 0.012, y, black: k === 0 }));
  return { x, y, angle: th + Math.PI / 2, sensors };
}

function overlayAt(p: RobotPose): SensorOverlay {
  return {
    lineSpots: p.sensors ?? [],
    sonars: [-0.4, 0.4].map((d, i) => ({
      x: p.x,
      y: p.y,
      angle: p.angle + d,
      coneRad: 0.26,
      maxM: 4,
      distanceM: i === 0 ? 0.42 : null,
      label: i === 0 ? '42 cm' : 'no echo',
    })),
    wheels: [1, -1].map((side) => ({
      x: p.x + side * 0.07 * Math.cos(p.angle + Math.PI / 2),
      y: p.y + side * 0.07 * Math.sin(p.angle + Math.PI / 2),
      angle: p.angle,
      speedMps: 0.3,
      label: '0.30 m/s',
    })),
  };
}

function frameTimes(arena: ArenaView, camera: Camera): { mean: number; times: number[] } {
  const canvas = document.createElement('canvas');
  canvas.width = 1800;
  canvas.height = 1200;
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2D context');
  const renderer = new ArenaRenderer(ctx, arena, ROBOT);
  renderer.setCamera(camera);
  const lap = 2400;
  // Fill the trail to its 2000-point cap (each lap step is > 5 mm apart on every arena).
  for (let i = 0; i < lap; i++) renderer.draw({ pose: poseAt(arena, i, lap), trail: false });

  const zones = {
    visitedZones: arena.zones.slice(0, 1).map((z) => z.id),
    nextZone: arena.zones[1]?.id ?? null,
  };
  const times: number[] = [];
  let start = 0;
  for (let f = 0; f < WARMUP + FRAMES; f++) {
    if (f === WARMUP) start = performance.now();
    const pose = poseAt(arena, lap + f, lap);
    const t0 = performance.now();
    renderer.draw({ pose, zones, overlay: overlayAt(pose), trail: true });
    ctx.getImageData(0, 0, 1, 1);
    const ms = performance.now() - t0;
    if (f >= WARMUP) times.push(ms);
  }
  const mean = (performance.now() - start) / FRAMES;
  canvas.remove();
  return { mean, times };
}

const p95 = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)] ?? NaN;

describe.each(BUILTIN_ARENAS)('2D frame on $id', (builtin) => {
  const arena = view(builtin);
  it.each([
    ['fit', FIT_CAMERA],
    ['zoomed in', { zoom: 3, center: { x: arena.widthM / 2, y: arena.heightM / 2 } }],
  ] as const)(`stays under ${BUDGET_MS} ms (%s)`, (_view, camera) => {
    const { mean, times } = frameTimes(arena, camera);
    expect(mean).toBeLessThan(BUDGET_MS);
    expect(p95(times)).toBeLessThan(BUDGET_MS);
  });
});
