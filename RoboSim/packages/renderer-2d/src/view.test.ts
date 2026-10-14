import { describe, expect, it } from 'vitest';
import { fitTransform, robotToWorld, toCanvas } from './view.js';

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
