import type { ComponentDefinition } from '@robosim/sim-core';
import { manifest } from './manifest.js';
import { ActiveBuzzer, type ActiveBuzzerProps } from './model.js';

export const definition: ComponentDefinition<ActiveBuzzerProps> = {
  manifest,
  create: () => new ActiveBuzzer(),
};
export { ActiveBuzzer, type ActiveBuzzerProps, type ActiveBuzzerState } from './model.js';
export { manifest } from './manifest.js';
