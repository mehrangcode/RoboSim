import type { ArenaSpec, ChallengeSpec } from '@robosim/sim-core';
import { BUILTIN_ARENAS } from './arenas/index.js';

export * from './arenas/index.js';

/** Built-in arenas by id (Release Plan P1: built-in arenas). */
export const ARENAS: Readonly<Record<string, ArenaSpec>> = Object.fromEntries(
  BUILTIN_ARENAS.map((a) => [a.id, a.spec]),
);

/** Default challenge per built-in arena that has one. */
export const CHALLENGES: Readonly<Record<string, ChallengeSpec>> = Object.fromEntries(
  BUILTIN_ARENAS.flatMap((a) => (a.challenge ? [[a.id, a.challenge]] : [])),
);
