import type { ArenaSpec, ChallengeSpec } from '@robosim/sim-core';
import { stadiumPath } from './shapes.js';

const W = 2.4;
const H = 1.6;
const CENTER = { x: W / 2, y: H / 2 };
const STRAIGHT = 1.0;
const RADIUS = 0.5;

/**
 * Built-in starter arena (US-ARN-02): 18 mm black tape stadium on a white mat, walls around the
 * edge. The robot starts on the bottom straight heading +x and laps counter-clockwise through the
 * checkpoints in order.
 */
export const ovalArena: ArenaSpec = {
  id: 'oval',
  widthM: W,
  heightM: H,
  floor: {
    background: 1,
    strokes: [
      {
        kind: 'polyline',
        points: stadiumPath(CENTER, STRAIGHT, RADIUS),
        closed: true,
        widthMm: 18,
        value: 0,
      },
    ],
  },
  start: { x: CENTER.x - 0.3, y: CENTER.y - RADIUS, angle: 0 },
  zones: [
    { id: 'start', kind: 'start', center: { x: CENTER.x - 0.3, y: CENTER.y - RADIUS }, radiusM: 0.12 },
    {
      id: 'cp-right',
      kind: 'checkpoint',
      center: { x: CENTER.x + STRAIGHT / 2 + RADIUS, y: CENTER.y },
      radiusM: 0.15,
    },
    { id: 'cp-top', kind: 'checkpoint', center: { x: CENTER.x, y: CENTER.y + RADIUS }, radiusM: 0.15 },
    {
      id: 'cp-left',
      kind: 'checkpoint',
      center: { x: CENTER.x - STRAIGHT / 2 - RADIUS, y: CENTER.y },
      radiusM: 0.15,
    },
  ],
};

/** US-ARN-08 / Technical Design §5.7 example: one lap in under 60 s, clean and on the line. */
export const ovalChallenge: ChallengeSpec = {
  id: 'oval-one-lap',
  condition: {
    all: [
      { type: 'laps', count: 1 },
      { type: 'timeLimit', seconds: 60 },
      { type: 'noCollision', tolerance: 0 },
      { type: 'onLineRatio', min: 0.85 },
    ],
  },
  score: [
    { type: 'laps', weight: 60 },
    { type: 'timeBonus', under: 45, weight: 25 },
    { type: 'onLineRatio', weight: 15 },
  ],
};
