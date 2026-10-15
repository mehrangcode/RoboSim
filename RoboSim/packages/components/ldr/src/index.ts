import type { ComponentDefinition } from '@robosim/sim-core';
import { manifest } from './manifest.js';
import { Ldr, type LdrProps } from './model.js';

export const definition: ComponentDefinition<LdrProps> = { manifest, create: () => new Ldr() };
export { Ldr, type LdrProps, type LdrState } from './model.js';
export { manifest } from './manifest.js';
