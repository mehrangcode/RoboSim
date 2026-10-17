import type { ComponentDefinition } from '@robosim/sim-core';
import { manifest } from './manifest.js';
import { DecadeCounter, type DecadeCounterProps } from './model.js';

export const definition: ComponentDefinition<DecadeCounterProps> = {
  manifest,
  create: () => new DecadeCounter(),
};
export { DecadeCounter, type DecadeCounterProps, type DecadeCounterState } from './model.js';
export { manifest } from './manifest.js';
