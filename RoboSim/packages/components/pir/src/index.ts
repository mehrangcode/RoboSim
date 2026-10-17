import type { ComponentDefinition } from '@robosim/sim-core';
import { manifest } from './manifest.js';
import { Pir, type PirProps } from './model.js';

export const definition: ComponentDefinition<PirProps> = { manifest, create: () => new Pir() };
export { Pir, type PirProps, type PirState } from './model.js';
export { manifest } from './manifest.js';
