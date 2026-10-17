import type { ArenaSpec, ChallengeSpec } from '@robosim/sim-core';
import {
  figureEightArena,
  figureEightChallenge,
  gapsArena,
  gapsChallenge,
  squareArena,
  squareChallenge,
} from './line-tracks.js';
import {
  mazeArena,
  mazeChallenge,
  obstacleCourseArena,
  obstacleCourseChallenge,
  openFloorArena,
  sumoArena,
  sumoChallenge,
} from './open-arenas.js';
import { ovalArena, ovalChallenge } from './oval.js';

/*
 * Built-in arenas (FR-ARN-05), engine-free (`@robosim/content/arenas`): specs are plain data, so the
 * editor's arena picker and start-pose editor use them without loading the simulator.
 */

export type ArenaFamily = 'line' | 'obstacles' | 'maze' | 'sumo' | 'open';

export interface BuiltinArena {
  /** Stable id stored in projects (`arena.arenaVersionId`); i18n `shell:arenas.<id>`. */
  readonly id: string;
  readonly family: ArenaFamily;
  readonly spec: ArenaSpec;
  /** What a project on this arena must do by default; null for free driving. */
  readonly challenge: ChallengeSpec | null;
}

/** Picker order: line tracks from easy to hard, then the other families. */
export const BUILTIN_ARENAS: readonly BuiltinArena[] = [
  { id: 'oval', family: 'line', spec: ovalArena, challenge: ovalChallenge },
  { id: 'oval-gaps', family: 'line', spec: gapsArena, challenge: gapsChallenge },
  { id: 'square', family: 'line', spec: squareArena, challenge: squareChallenge },
  { id: 'figure-eight', family: 'line', spec: figureEightArena, challenge: figureEightChallenge },
  {
    id: 'obstacle-course',
    family: 'obstacles',
    spec: obstacleCourseArena,
    challenge: obstacleCourseChallenge,
  },
  { id: 'maze', family: 'maze', spec: mazeArena, challenge: mazeChallenge },
  { id: 'sumo', family: 'sumo', spec: sumoArena, challenge: sumoChallenge },
  { id: 'open-floor', family: 'open', spec: openFloorArena, challenge: null },
];

export const findArena = (id: string): BuiltinArena | undefined => BUILTIN_ARENAS.find((a) => a.id === id);

export { ovalArena, ovalChallenge } from './oval.js';
export { lemniscatePath, rectanglePath, stadiumPath } from './shapes.js';
export { mazeOpenings, mazeWalls, MAZE_SIZE } from './open-arenas.js';
export {
  circleHitsPolygon,
  obstacleOutline,
  placeOutline,
  polygonsOverlap,
  startPoseProblem,
  type PoseProblem,
} from './fit.js';
