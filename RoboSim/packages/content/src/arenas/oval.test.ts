import { floorAt, rasterizeFloor, validateChallenge } from '@robosim/sim-core';
import { describe, expect, it } from 'vitest';
import { ovalArena, ovalChallenge, stadiumPath } from '../index.js';

describe('oval arena', () => {
  const raster = rasterizeFloor(ovalArena.floor, ovalArena.widthM, ovalArena.heightM);

  it('rasterises at 1 px = 1 mm', () => {
    expect(raster.widthPx).toBe(2400);
    expect(raster.heightPx).toBe(1600);
  });

  it('puts the start pose on the line and every checkpoint on the line', () => {
    expect(floorAt(raster, ovalArena.start)).toBe(0);
    for (const z of ovalArena.zones ?? []) expect(floorAt(raster, z.center), z.id).toBe(0);
  });

  it('line is 18 mm wide: white 10 mm off-centre, black at 8 mm', () => {
    const { x, y } = ovalArena.start;
    expect(floorAt(raster, { x, y: y + 0.008 })).toBe(0);
    expect(floorAt(raster, { x, y: y + 0.01 })).toBe(1);
    expect(floorAt(raster, { x, y: y - 0.01 })).toBe(1);
  });

  it('stadium path is closed-ready and runs counter-clockwise', () => {
    const pts = stadiumPath({ x: 0, y: 0 }, 1, 0.5, 8);
    let area2 = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      area2 += (a?.x ?? 0) * (b?.y ?? 0) - (b?.x ?? 0) * (a?.y ?? 0);
    }
    expect(area2).toBeGreaterThan(0);
  });

  it('ships a valid default challenge', () => {
    expect(validateChallenge(ovalChallenge, { zones: ovalArena.zones ?? [], objects: [] })).toEqual([]);
  });

  it('rasterisation is deterministic', () => {
    const again = rasterizeFloor(ovalArena.floor, ovalArena.widthM, ovalArena.heightM);
    let diffs = 0;
    for (let i = 0; i < raster.data.length; i++) if (raster.data[i] !== again.data[i]) diffs++;
    expect(diffs).toBe(0);
  });
});
