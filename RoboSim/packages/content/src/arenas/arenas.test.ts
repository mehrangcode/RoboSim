import { chassisGeometry } from '@robosim/component-chassis-2wd/geometry';
import { floorAt, rasterizeFloor, validateChallenge } from '@robosim/sim-core';
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_ARENAS,
  circleHitsPolygon,
  findArena,
  mazeOpenings,
  MAZE_SIZE,
  polygonsOverlap,
  startPoseProblem,
} from './index.js';

const footprint = chassisGeometry({
  trackWidthMm: 130,
  wheelDiameterMm: 65,
  lengthMm: 210,
  widthMm: 150,
  bodyCenterXMm: -30,
  casterXMm: -110,
  bodyMassG: 160,
}).footprint;

describe('built-in arenas', () => {
  it('has one entry per id, matching the spec id, for all five families', () => {
    const ids = BUILTIN_ARENAS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of BUILTIN_ARENAS) expect(a.spec.id).toBe(a.id);
    expect(new Set(BUILTIN_ARENAS.map((a) => a.family))).toEqual(
      new Set(['line', 'obstacles', 'maze', 'sumo', 'open']),
    );
    expect(findArena('maze')?.family).toBe('maze');
    expect(findArena('nope')).toBeUndefined();
  });

  describe.each(BUILTIN_ARENAS.map((a) => [a.id, a] as const))('%s', (_id, a) => {
    it('the default start pose fits the stock chassis', () => {
      expect(startPoseProblem(a.spec, footprint, a.spec.start)).toBeNull();
    });

    it('zones lie inside the arena', () => {
      for (const z of a.spec.zones ?? []) {
        expect(z.center.x - z.radiusM, z.id).toBeGreaterThanOrEqual(0);
        expect(z.center.y - z.radiusM, z.id).toBeGreaterThanOrEqual(0);
        expect(z.center.x + z.radiusM, z.id).toBeLessThanOrEqual(a.spec.widthM);
        expect(z.center.y + z.radiusM, z.id).toBeLessThanOrEqual(a.spec.heightM);
      }
    });

    it('ships a challenge that validates against the arena', () => {
      if (!a.challenge) return;
      const objects = (a.spec.obstacles ?? []).filter((o) => o.dynamic).map((o) => o.id);
      expect(validateChallenge(a.challenge, { zones: a.spec.zones ?? [], objects })).toEqual([]);
    });
  });

  describe.each(BUILTIN_ARENAS.filter((a) => a.family === 'line').map((a) => [a.id, a] as const))(
    'line track %s',
    (_id, a) => {
      const raster = rasterizeFloor(a.spec.floor, a.spec.widthM, a.spec.heightM);

      it('starts on the line, heading along it, and every checkpoint is on the line', () => {
        const { x, y, angle } = a.spec.start;
        expect(floorAt(raster, { x, y })).toBe(0);
        // 3 cm ahead is still on the 18 mm tape when the heading follows the line.
        expect(floorAt(raster, { x: x + 0.03 * Math.cos(angle), y: y + 0.03 * Math.sin(angle) })).toBe(0);
        for (const z of a.spec.zones ?? []) {
          if (z.kind === 'checkpoint') expect(floorAt(raster, z.center), z.id).toBe(0);
        }
      });
    },
  );

  it('the gaps track has four breaks in the tape', () => {
    const a = findArena('oval-gaps')?.spec;
    if (!a) throw new Error('missing');
    const raster = rasterizeFloor(a.floor, a.widthM, a.heightM);
    const bottom = [1.1, 1.5].map((x) => floorAt(raster, { x, y: 0.3 }));
    const top = [1.0, 1.4].map((x) => floorAt(raster, { x, y: 1.3 }));
    expect([...bottom, ...top]).toEqual([1, 1, 1, 1]);
  });

  it('the wide-gaps track breaks the tape in the middle of both bends', () => {
    const a = findArena('oval-wide-gaps')?.spec;
    if (!a) throw new Error('missing');
    const raster = rasterizeFloor(a.floor, a.widthM, a.heightM);
    const at = (cx: number, deg: number) =>
      floorAt(raster, {
        x: cx + 0.5 * Math.cos((deg * Math.PI) / 180),
        y: 0.8 + 0.5 * Math.sin((deg * Math.PI) / 180),
      });
    expect([at(1.7, -45), at(1.7, 45), at(0.7, 135), at(0.7, 225)]).toEqual([1, 1, 1, 1]);
    expect([at(1.7, 0), at(0.7, 180)]).toEqual([0, 0]);
  });

  it('the maze is solvable from the start cell to the goal cell', () => {
    const open = mazeOpenings();
    const goal = `${MAZE_SIZE - 1},${MAZE_SIZE - 1}`;
    const seen = new Set(['0,0']);
    const queue: [number, number][] = [[0, 0]];
    while (queue.length) {
      const cell = queue.shift() as [number, number];
      for (const next of open.get(cell.join()) ?? []) {
        if (!seen.has(next.join())) {
          seen.add(next.join());
          queue.push(next);
        }
      }
    }
    expect(seen.has(goal)).toBe(true);
    expect(seen.size).toBe(MAZE_SIZE * MAZE_SIZE); // a perfect maze: every cell reachable
  });
});

describe('start pose checks', () => {
  const oval = findArena('oval')?.spec;
  const course = findArena('obstacle-course')?.spec;
  if (!oval || !course) throw new Error('missing arenas');

  it('rejects a pose hanging over the edge of the mat', () => {
    expect(startPoseProblem(oval, footprint, { x: 0.05, y: 0.8, angle: 0 })).toEqual({ kind: 'outside' });
  });

  it('rejects a pose overlapping a box or a post, and accepts one beside it', () => {
    expect(startPoseProblem(course, footprint, { x: 0.95, y: 0.8, angle: 0 })).toEqual({
      kind: 'obstacle',
      id: 'block-1',
    });
    expect(startPoseProblem(course, footprint, { x: 1.55, y: 0.45, angle: Math.PI / 2 })).toEqual({
      kind: 'obstacle',
      id: 'post-1',
    });
    expect(startPoseProblem(course, footprint, { x: 0.6, y: 0.3, angle: 0 })).toBeNull();
  });

  it('separating-axis and circle tests', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    const moved = (dx: number) => square.map((p) => ({ x: p.x + dx, y: p.y }));
    expect(polygonsOverlap(square, moved(0.5))).toBe(true);
    expect(polygonsOverlap(square, moved(1))).toBe(false); // touching
    expect(circleHitsPolygon({ x: 1.2, y: 0.5 }, 0.3, square)).toBe(true);
    expect(circleHitsPolygon({ x: 1.4, y: 0.5 }, 0.3, square)).toBe(false);
    expect(circleHitsPolygon({ x: 0.5, y: 0.5 }, 0.01, square)).toBe(true); // centre inside
  });
});
