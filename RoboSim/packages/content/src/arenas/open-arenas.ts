import type { ArenaSpec, ChallengeSpec, ObstacleSpec } from '@robosim/sim-core';

/* Non-line arenas (FR-ARN-05): obstacle course, maze, sumo ring and open floor. */

// Obstacle course: drive from the start box on the left to the goal on the right, around blocks.
export const obstacleCourseArena: ArenaSpec = {
  id: 'obstacle-course',
  widthM: 3.0,
  heightM: 1.6,
  floor: { background: 1, strokes: [] },
  obstacles: [
    { id: 'block-1', shape: { kind: 'box', widthM: 0.2, heightM: 0.5 }, pose: { x: 0.95, y: 0.8, angle: 0 } },
    { id: 'post-1', shape: { kind: 'circle', radiusM: 0.1 }, pose: { x: 1.55, y: 0.4, angle: 0 } },
    { id: 'post-2', shape: { kind: 'circle', radiusM: 0.1 }, pose: { x: 1.55, y: 1.2, angle: 0 } },
    {
      id: 'block-2',
      shape: { kind: 'box', widthM: 0.15, heightM: 0.6 },
      pose: { x: 2.2, y: 0.85, angle: Math.PI / 6 },
    },
  ],
  start: { x: 0.3, y: 0.8, angle: 0 },
  zones: [
    { id: 'start', kind: 'start', center: { x: 0.3, y: 0.8 }, radiusM: 0.15 },
    { id: 'goal', kind: 'goal', center: { x: 2.7, y: 0.8 }, radiusM: 0.2 },
  ],
};

export const obstacleCourseChallenge: ChallengeSpec = {
  id: 'obstacle-course-goal',
  condition: {
    all: [
      { type: 'reachZone', zone: 'goal' },
      { type: 'timeLimit', seconds: 120 },
    ],
  },
  score: [
    { type: 'timeBonus', under: 40, weight: 60 },
    { type: 'noCollision', weight: 40 },
  ],
};

/*
 * Maze: 5 × 5 cells of 45 cm, start bottom-left, goal top-right. Interior walls are drawn below
 * (the arena edge is the perimeter wall); '|' is a wall on a cell's left edge, '--' on its top edge.
 */
const MAZE = [
  '+--+--+--+--+--+',
  '|  |        |  |',
  '+  +  +--+  +  +',
  '|     |     |  |',
  '+--+--+  +--+  +',
  '|        |     |',
  '+  +--+--+  +--+',
  '|  |     |     |',
  '+  +  +  +--+  +',
  '|     |        |',
  '+--+--+--+--+--+',
];
const CELL = 0.45;
const WALL = 0.02;

/** Interior wall segments of {@link MAZE} as static boxes (rows counted from the top). */
export function mazeWalls(rows: readonly string[] = MAZE, cell = CELL): ObstacleSpec[] {
  const n = (rows.length - 1) / 2;
  const cols = ((rows[0] ?? '').length - 1) / 3;
  const walls: ObstacleSpec[] = [];
  const add = (x: number, y: number, horizontal: boolean): void => {
    walls.push({
      id: `wall-${walls.length + 1}`,
      shape: horizontal
        ? { kind: 'box', widthM: cell + WALL, heightM: WALL }
        : { kind: 'box', widthM: WALL, heightM: cell + WALL },
      pose: { x, y, angle: 0 },
    });
  };
  for (let r = 1; r < n; r++) {
    const line = rows[2 * r] ?? '';
    for (let c = 0; c < cols; c++) {
      if (line.slice(3 * c + 1, 3 * c + 3) === '--') add((c + 0.5) * cell, (n - r) * cell, true);
    }
  }
  for (let r = 0; r < n; r++) {
    const line = rows[2 * r + 1] ?? '';
    for (let c = 1; c < cols; c++) {
      if (line[3 * c] === '|') add(c * cell, (n - r - 0.5) * cell, false);
    }
  }
  return walls;
}

/** Open sides of every cell, for the solvability test: `[col, row]` from the bottom-left. */
export function mazeOpenings(rows: readonly string[] = MAZE): Map<string, [number, number][]> {
  const n = (rows.length - 1) / 2;
  const cols = ((rows[0] ?? '').length - 1) / 3;
  const open = new Map<string, [number, number][]>();
  const link = (a: [number, number], b: [number, number]): void => {
    open.set(a.join(), [...(open.get(a.join()) ?? []), b]);
    open.set(b.join(), [...(open.get(b.join()) ?? []), a]);
  };
  for (let r = 0; r < n; r++) {
    const row = n - 1 - r; // from the bottom
    const cells = rows[2 * r + 1] ?? '';
    const below = rows[2 * r + 2] ?? '';
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols && cells[3 * (c + 1)] !== '|') link([c, row], [c + 1, row]);
      if (row > 0 && below.slice(3 * c + 1, 3 * c + 3) !== '--') link([c, row], [c, row - 1]);
    }
  }
  return open;
}

export const MAZE_SIZE = 5;

export const mazeArena: ArenaSpec = {
  id: 'maze',
  widthM: MAZE_SIZE * CELL,
  heightM: MAZE_SIZE * CELL,
  floor: { background: 1, strokes: [] },
  obstacles: mazeWalls(),
  start: { x: CELL / 2, y: CELL / 2, angle: Math.PI / 2 },
  zones: [
    { id: 'start', kind: 'start', center: { x: CELL / 2, y: CELL / 2 }, radiusM: 0.15 },
    { id: 'goal', kind: 'goal', center: { x: 4.5 * CELL, y: 4.5 * CELL }, radiusM: 0.15 },
  ],
};

export const mazeChallenge: ChallengeSpec = {
  id: 'maze-goal',
  condition: {
    all: [
      { type: 'reachZone', zone: 'goal' },
      { type: 'timeLimit', seconds: 240 },
    ],
  },
  score: [
    { type: 'timeBonus', under: 90, weight: 70 },
    { type: 'noCollision', weight: 30 },
  ],
};

/*
 * Sumo ring: a 1.54 m black dohyo with a 5 cm white edge on a grey floor, and a pushable 500 g
 * block as the opponent. Push it out of the ring without leaving it yourself (axle midpoint).
 */
const RING = { x: 1.0, y: 1.0 };
const RING_R = 0.77;

export const sumoArena: ArenaSpec = {
  id: 'sumo',
  widthM: 2.0,
  heightM: 2.0,
  floor: {
    background: 0.6,
    strokes: [
      { kind: 'circle', center: RING, radiusM: RING_R, value: 1 },
      { kind: 'circle', center: RING, radiusM: RING_R - 0.05, value: 0 },
    ],
  },
  obstacles: [
    {
      id: 'opponent',
      shape: { kind: 'box', widthM: 0.15, heightM: 0.15 },
      pose: { x: 1.35, y: 1.0, angle: 0 },
      dynamic: true,
      massKg: 0.5,
    },
  ],
  start: { x: 0.55, y: 1.0, angle: 0 },
  zones: [{ id: 'ring', kind: 'area', center: RING, radiusM: RING_R }],
};

export const sumoChallenge: ChallengeSpec = {
  id: 'sumo-push-out',
  condition: {
    all: [
      { type: 'pushOut', object: 'opponent', zone: 'ring' },
      { type: 'stayInZone', zone: 'ring' },
      { type: 'timeLimit', seconds: 60 },
    ],
  },
  score: [{ type: 'timeBonus', under: 15, weight: 100 }],
};

/** Open floor: a plain walled mat for free driving; no challenge. */
export const openFloorArena: ArenaSpec = {
  id: 'open-floor',
  widthM: 3.0,
  heightM: 2.0,
  floor: { background: 1, strokes: [] },
  start: { x: 1.5, y: 1.0, angle: 0 },
};
