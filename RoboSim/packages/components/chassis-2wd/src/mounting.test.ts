import { describe, expect, it } from 'vitest';
import { chassisGeometry, type Chassis2wdProps } from './geometry.js';
import { manifest } from './manifest.js';
import { FRONT_OVERHANG_MM, mountOverlaps, mountProblem, snapMount, type MountedBox } from './mounting.js';

const props = Object.fromEntries(
  Object.entries(manifest.props).map(([k, p]) => [k, p.default]),
) as unknown as Chassis2wdProps;
const front = props.bodyCenterXMm + props.lengthMm / 2;

const box = (id: string, x: number, y: number, z: number, yaw = 0): MountedBox => ({
  id,
  pose: { x, y, z, yaw },
  lengthMm: 40,
  widthMm: 20,
  heightMm: 10,
  overhang: false,
});

describe('FR-ARN-09 mounting rules', () => {
  it('accepts every chassis slot and refuses points off the plate', () => {
    for (const s of chassisGeometry(props).mountSlots)
      expect(mountProblem(props, { x: s.xMm, y: s.yMm, z: s.heightMm }, false), s.id).toBeNull();
    expect(mountProblem(props, { x: front + 1, y: 0, z: 5 }, false)).toBe('offChassis');
    expect(mountProblem(props, { x: 0, y: props.widthMm / 2 + 1, z: 5 }, false)).toBe('offChassis');
    expect(mountProblem(props, { x: 0, y: 0, z: -1 }, false)).toBe('height');
  });

  it('lets sensors overhang the front, up to the limit', () => {
    expect(mountProblem(props, { x: front + FRONT_OVERHANG_MM, y: 0, z: 5 }, true)).toBeNull();
    expect(mountProblem(props, { x: front + FRONT_OVERHANG_MM + 1, y: 0, z: 5 }, true)).toBe('offChassis');
  });

  it('reports overlaps only when outline and height range both overlap', () => {
    expect(mountOverlaps([box('a', 0, 0, 10), box('b', 30, 0, 10)])).toEqual([['a', 'b']]);
    expect(mountOverlaps([box('a', 0, 0, 10), box('b', 40, 0, 10)])).toEqual([]); // touching
    expect(mountOverlaps([box('a', 0, 0, 10), box('b', 30, 0, 20)])).toEqual([]); // stacked
    // Turned 90°, b's 40 mm side runs along y and clears a.
    expect(mountOverlaps([box('a', 0, 0, 10), box('b', 31, 0, 10, 90)])).toEqual([]);
  });

  it('snaps to a nearby slot, else to the grid; Shift keeps 0.1 mm', () => {
    const slots = chassisGeometry(props).mountSlots;
    const deck = slots.find((s) => s.id === 'deck');
    expect(snapMount(slots, { x: (deck?.xMm ?? 0) + 3, y: 4 }, false).slot?.id).toBe('deck');
    // Front bracket (5 mm) and front top (60 mm) coincide from above: height decides.
    expect(snapMount(slots, { x: 62, y: 0 }, false, 0).slot?.id).toBe('front-bracket');
    expect(snapMount(slots, { x: 62, y: 0 }, false, 45).slot?.id).toBe('front-top');
    expect(snapMount(slots, { x: -100.4, y: 30.6 }, false)).toEqual({ x: -100, y: 31, slot: null });
    expect(snapMount(slots, { x: -100.44, y: 30.66 }, true)).toEqual({ x: -100.4, y: 30.7, slot: null });
  });
});
