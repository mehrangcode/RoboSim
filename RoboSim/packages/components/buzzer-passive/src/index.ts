import type { ComponentDefinition } from '@robosim/sim-core';
import { manifest } from './manifest.js';
import { PassiveBuzzer, type PassiveBuzzerProps } from './model.js';

export const definition: ComponentDefinition<PassiveBuzzerProps> = {
  manifest,
  create: () => new PassiveBuzzer(),
};
export { PassiveBuzzer, type PassiveBuzzerProps, type PassiveBuzzerState } from './model.js';
export { manifest } from './manifest.js';
