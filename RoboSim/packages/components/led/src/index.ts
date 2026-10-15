import type { ComponentDefinition } from '@robosim/sim-core';
import { manifest } from './manifest.js';
import { Led, type LedProps } from './model.js';

export const definition: ComponentDefinition<LedProps> = { manifest, create: () => new Led() };
export { Led, type LedColor, type LedProps, type LedState } from './model.js';
export { manifest } from './manifest.js';
