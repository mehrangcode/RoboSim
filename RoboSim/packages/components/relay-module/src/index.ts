import type { ComponentDefinition } from '@robosim/sim-core';
import { manifest } from './manifest.js';
import { RelayModule, type RelayModuleProps } from './model.js';

export const definition: ComponentDefinition<RelayModuleProps> = {
  manifest,
  create: () => new RelayModule(),
};
export { RelayModule, type RelayModuleProps, type RelayModuleState, type RelayTrigger } from './model.js';
export { manifest } from './manifest.js';
