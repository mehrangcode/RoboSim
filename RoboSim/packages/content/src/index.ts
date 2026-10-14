import type { ArenaSpec, ChallengeSpec } from '@robosim/sim-core';
import { ovalArena, ovalChallenge } from './arenas/oval.js';

export { ovalArena, ovalChallenge } from './arenas/oval.js';
export { stadiumPath } from './arenas/shapes.js';

/** Built-in arenas by id (Release Plan P1: built-in arenas). */
export const ARENAS: Readonly<Record<string, ArenaSpec>> = { oval: ovalArena };

/** Default challenge per built-in arena. */
export const CHALLENGES: Readonly<Record<string, ChallengeSpec>> = { oval: ovalChallenge };
