import type { ComponentPose, Vec2, WorldModel } from './contracts.js';
import { cos, sin } from './dmath/index.js';

/** Transforms a point given in the component's local frame (mm, +x forward) to world metres. */
export function toWorld(pose: ComponentPose, localMm: Vec2 = { x: 0, y: 0 }): Vec2 {
  const c = cos(pose.angle);
  const s = sin(pose.angle);
  const x = localMm.x / 1000;
  const y = localMm.y / 1000;
  return { x: pose.position.x + c * x - s * y, y: pose.position.y + s * x + c * y };
}

/** IR reflective sensors (TCRT5000 class) work best at 2–8 mm; signal fades out by 25 mm. */
const IR_OPTIMAL_MM = 8;
const IR_MAX_MM = 25;

/** Spot radius on the floor: the emitter/receiver cone widens with height (Technical Design §5.5). */
export function irSpotRadiusMm(heightMm: number): number {
  return 1.5 + 0.5 * Math.max(0, heightMm);
}

/** 0..1 reflected IR seen by a reflective sensor at `localMm` on the component (0 = no return). */
export function irReflectance(
  world: WorldModel,
  pose: ComponentPose,
  localMm: Vec2 = { x: 0, y: 0 },
): number {
  const h = pose.heightMm;
  const heightGain =
    h <= IR_OPTIMAL_MM ? 1 : h >= IR_MAX_MM ? 0 : (IR_MAX_MM - h) / (IR_MAX_MM - IR_OPTIMAL_MM);
  if (heightGain === 0) return 0;
  return heightGain * world.sampleFloor(toWorld(pose, localMm), irSpotRadiusMm(h) / 1000);
}

/**
 * Ultrasonic ranging: casts `rays` rays evenly across a `coneDeg` cone along the component's heading
 * and returns the nearest hit (m) within [minM, maxM], or null (Technical Design §5.5: 7 rays, 15°).
 */
export function sonarRange(
  world: WorldModel,
  pose: ComponentPose,
  {
    coneDeg = 15,
    rays = 7,
    minM = 0.02,
    maxM = 4,
  }: { coneDeg?: number; rays?: number; minM?: number; maxM?: number } = {},
): number | null {
  const origin = pose.position;
  let nearest: number | null = null;
  for (let i = 0; i < rays; i++) {
    const offset = rays === 1 ? 0 : ((i / (rays - 1) - 0.5) * coneDeg * Math.PI) / 180;
    const a = pose.angle + offset;
    const hit = world.raycast(origin, { x: cos(a), y: sin(a) }, maxM);
    if (hit && hit.distance >= minM && (nearest === null || hit.distance < nearest)) nearest = hit.distance;
  }
  return nearest;
}

export const SPEED_OF_SOUND_M_S = 343;
