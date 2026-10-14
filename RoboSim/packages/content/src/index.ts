import type { ArenaSpec } from '@robosim/sim-core';
import { ovalArena } from './arenas/oval.js';

export { ovalArena } from './arenas/oval.js';
export { stadiumPath } from './arenas/shapes.js';

/** Built-in arenas by id (Release Plan P1: built-in arenas). */
export const ARENAS: Readonly<Record<string, ArenaSpec>> = { oval: ovalArena };
