import type { ComponentDefinition } from '@robosim/sim-core';
import { manifest } from './manifest.js';
import { Ne555, type Ne555Props } from './model.js';

export const definition: ComponentDefinition<Ne555Props> = { manifest, create: () => new Ne555() };
export { Ne555, type Ne555Props, type Ne555State } from './model.js';
export { manifest } from './manifest.js';
