import type { ArenaSpec, ChallengeSpec, FloorStroke } from '@robosim/sim-core';
import * as dmath from '@robosim/sim-core/dmath';
import { lemniscatePath, rectanglePath, stadiumPath } from './shapes.js';

/*
 * Line-track variants (FR-ARN-05): 18 mm black tape on a white mat, walls around the edge. Each
 * starts on the line heading along it and laps through its checkpoints in order.
 */

const TAPE_MM = 18;
const tape = (points: ReturnType<typeof stadiumPath>, closed = true): FloorStroke => ({
  kind: 'polyline',
  points,
  closed,
  widthMm: TAPE_MM,
  value: 0,
});

/** One lap under `seconds`, clean and on the line — the line-track default challenge. */
function lapChallenge(id: string, seconds: number, bonusUnder: number, onLine = 0.85): ChallengeSpec {
  return {
    id,
    condition: {
      all: [
        { type: 'laps', count: 1 },
        { type: 'timeLimit', seconds },
        { type: 'noCollision', tolerance: 0 },
        { type: 'onLineRatio', min: onLine },
      ],
    },
    score: [
      { type: 'laps', weight: 60 },
      { type: 'timeBonus', under: bonusUnder, weight: 25 },
      { type: 'onLineRatio', weight: 15 },
    ],
  };
}

// Figure eight: a = 1.1 m lemniscate centred in 2.8 × 1.4 m; tightest bend radius a/3 ≈ 37 cm.
const F8 = { x: 1.4, y: 0.7 };
const F8_A = 1.1;

export const figureEightArena: ArenaSpec = {
  id: 'figure-eight',
  widthM: 2.8,
  heightM: 1.4,
  floor: { background: 1, strokes: [tape(lemniscatePath(F8, F8_A))] },
  // Bottom of the right lobe, where the line runs along +x.
  start: { x: 2.074, y: 0.311, angle: 0 },
  zones: [
    { id: 'start', kind: 'start', center: { x: 2.074, y: 0.311 }, radiusM: 0.12 },
    { id: 'cp-right', kind: 'checkpoint', center: { x: F8.x + F8_A, y: F8.y }, radiusM: 0.15 },
    { id: 'cp-left', kind: 'checkpoint', center: { x: F8.x - F8_A, y: F8.y }, radiusM: 0.15 },
  ],
};

export const figureEightChallenge = lapChallenge('figure-eight-one-lap', 90, 60, 0.8);

// Square: 1.8 × 1.0 m rectangle with sharp 90° corners in 2.4 × 1.6 m.
const SQ = { x: 1.2, y: 0.8 };

export const squareArena: ArenaSpec = {
  id: 'square',
  widthM: 2.4,
  heightM: 1.6,
  floor: { background: 1, strokes: [tape(rectanglePath(SQ, 1.8, 1.0))] },
  start: { x: 0.9, y: 0.3, angle: 0 },
  zones: [
    { id: 'start', kind: 'start', center: { x: 0.9, y: 0.3 }, radiusM: 0.12 },
    { id: 'cp-right', kind: 'checkpoint', center: { x: 2.1, y: 0.8 }, radiusM: 0.15 },
    { id: 'cp-top', kind: 'checkpoint', center: { x: 1.2, y: 1.3 }, radiusM: 0.15 },
    { id: 'cp-left', kind: 'checkpoint', center: { x: 0.3, y: 0.8 }, radiusM: 0.15 },
  ],
};

export const squareChallenge = lapChallenge('square-one-lap', 90, 60, 0.8);

// Oval with gaps: the starter oval with four 40 mm breaks in the tape on the straights.
const GAP = { x: 1.2, y: 0.8 };
const GAP_R = 0.5;
const gapAt = (x: number, y: number): FloorStroke => ({
  kind: 'rect',
  min: { x: x - 0.02, y: y - 0.02 },
  max: { x: x + 0.02, y: y + 0.02 },
  value: 1,
});

export const gapsArena: ArenaSpec = {
  id: 'oval-gaps',
  widthM: 2.4,
  heightM: 1.6,
  floor: {
    background: 1,
    strokes: [
      tape(stadiumPath(GAP, 1.0, GAP_R)),
      gapAt(1.1, GAP.y - GAP_R),
      gapAt(1.5, GAP.y - GAP_R),
      gapAt(1.4, GAP.y + GAP_R),
      gapAt(1.0, GAP.y + GAP_R),
    ],
  },
  start: { x: 0.9, y: 0.3, angle: 0 },
  zones: [
    { id: 'start', kind: 'start', center: { x: 0.9, y: 0.3 }, radiusM: 0.12 },
    { id: 'cp-right', kind: 'checkpoint', center: { x: 2.2, y: 0.8 }, radiusM: 0.15 },
    { id: 'cp-top', kind: 'checkpoint', center: { x: 1.2, y: 1.3 }, radiusM: 0.15 },
    { id: 'cp-left', kind: 'checkpoint', center: { x: 0.2, y: 0.8 }, radiusM: 0.15 },
  ],
};

export const gapsChallenge = lapChallenge('oval-gaps-one-lap', 60, 45, 0.8);

// Oval with wide gaps on the bends: four 12 cm breaks at the 45° points of the two bends. Driving straight
// on across one leaves the curve, so a robot has to remember which way the line was bending.
const bendGap = (cx: number, deg: number): FloorStroke => ({
  kind: 'circle',
  center: {
    x: cx + GAP_R * dmath.cos((deg * Math.PI) / 180),
    y: GAP.y + GAP_R * dmath.sin((deg * Math.PI) / 180),
  },
  radiusM: 0.06,
  value: 1,
});

export const wideGapsArena: ArenaSpec = {
  id: 'oval-wide-gaps',
  widthM: 2.4,
  heightM: 1.6,
  floor: {
    background: 1,
    strokes: [
      tape(stadiumPath(GAP, 1.0, GAP_R)),
      bendGap(1.7, -45),
      bendGap(1.7, 45),
      bendGap(0.7, 135),
      bendGap(0.7, 225),
    ],
  },
  start: { x: 0.9, y: 0.3, angle: 0 },
  zones: [
    { id: 'start', kind: 'start', center: { x: 0.9, y: 0.3 }, radiusM: 0.12 },
    { id: 'cp-right', kind: 'checkpoint', center: { x: 2.2, y: 0.8 }, radiusM: 0.15 },
    { id: 'cp-top', kind: 'checkpoint', center: { x: 1.2, y: 1.3 }, radiusM: 0.15 },
    { id: 'cp-left', kind: 'checkpoint', center: { x: 0.2, y: 0.8 }, radiusM: 0.15 },
  ],
};

export const wideGapsChallenge = lapChallenge('oval-wide-gaps-one-lap', 60, 45, 0.75);
