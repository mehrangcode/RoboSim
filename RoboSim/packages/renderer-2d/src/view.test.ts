import { describe, expect, it } from 'vitest';
import {
  FIT_CAMERA,
  MAX_ZOOM,
  MIN_ZOOM,
  cameraTransform,
  fitTransform,
  handlePoint,
  headingTowards,
  hitsRobot,
  robotToWorld,
  toCanvas,
  toWorld,
  zoomAt,
} from './view.js';

describe('view transform', () => {
  it('fits a 2.4 × 1.6 m arena into the canvas, centred, y flipped', () => {
    const t = fitTransform({ widthM: 2.4, heightM: 1.6 }, 1224, 1000, 12);
    expect(t.scale).toBe(500);
    expect(toCanvas(t, { x: 0, y: 0 })).toEqual({ x: 12, y: 1000 - t.offsetY });
    const top = toCanvas(t, { x: 2.4, y: 1.6 });
    expect(top.x).toBe(1212);
    expect(top.y).toBeCloseTo(t.offsetY, 9); // top edge
  });

  it('places robot-frame points by pose', () => {
    const p = robotToWorld({ x: 1, y: 1, angle: Math.PI / 2 }, { x: 0.1, y: 0 });
    expect(p.x).toBeCloseTo(1, 12);
    expect(p.y).toBeCloseTo(1.1, 12);
  });
});

describe('camera', () => {
  const arena = { widthM: 2, heightM: 1 };

  it('zoom 1 centred on the arena equals the fitted view', () => {
    const fit = fitTransform(arena, 424, 224);
    const cam = cameraTransform(arena, 424, 224, FIT_CAMERA);
    expect(cam.scale).toBe(fit.scale);
    expect(cam.offsetX).toBeCloseTo(fit.offsetX, 9);
    expect(cam.offsetY).toBeCloseTo(fit.offsetY, 9);
  });

  it('toWorld inverts toCanvas', () => {
    const t = cameraTransform(arena, 400, 300, { zoom: 2.5, center: { x: 0.4, y: 0.7 } });
    const p = toWorld(t, toCanvas(t, { x: 1.23, y: 0.45 }));
    expect(p.x).toBeCloseTo(1.23, 12);
    expect(p.y).toBeCloseTo(0.45, 12);
  });

  it('zooming keeps the world point under the cursor fixed and clamps the zoom', () => {
    const at = { x: 100, y: 80 };
    const before = toWorld(cameraTransform(arena, 400, 300, FIT_CAMERA), at);
    const cam = zoomAt(arena, 400, 300, FIT_CAMERA, at, 3);
    const after = toWorld(cameraTransform(arena, 400, 300, cam), at);
    expect(cam.zoom).toBe(3);
    expect(after.x).toBeCloseTo(before.x, 12);
    expect(after.y).toBeCloseTo(before.y, 12);
    expect(zoomAt(arena, 400, 300, FIT_CAMERA, at, 100).zoom).toBe(MAX_ZOOM);
    expect(zoomAt(arena, 400, 300, FIT_CAMERA, at, 0.01).zoom).toBe(MIN_ZOOM);
  });
});

describe('start-pose hit testing', () => {
  const robot = {
    footprint: [
      { x: -0.1, y: -0.05 },
      { x: 0.1, y: -0.05 },
      { x: 0.1, y: 0.05 },
      { x: -0.1, y: 0.05 },
    ],
    wheels: [],
    caster: { x: 0, y: 0 },
  };
  const pose = { x: 1, y: 1, angle: Math.PI / 2 };

  it('hits the rotated body and puts the handle ahead of the front edge', () => {
    expect(hitsRobot(robot, pose, { x: 1, y: 1.09 })).toBe(true);
    expect(hitsRobot(robot, pose, { x: 1.09, y: 1 })).toBe(false);
    const h = handlePoint(robot, pose);
    expect(h.x).toBeCloseTo(1, 12);
    expect(h.y).toBeCloseTo(1.16, 12);
  });

  it('heading towards a point, optionally snapped', () => {
    expect(headingTowards({ x: 0, y: 0 }, { x: 1, y: 1 })).toBeCloseTo(Math.PI / 4, 12);
    const step = Math.PI / 12; // 15°
    expect(headingTowards({ x: 0, y: 0 }, { x: 1, y: 0.3 }, step)).toBeCloseTo(step, 12);
  });
});
