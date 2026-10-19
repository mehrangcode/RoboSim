import type { ComponentDefinition } from '@robosim/sim-core';
import { manifest } from './manifest.js';
import { Irf520Module, type Irf520ModuleProps } from './model.js';

export const definition: ComponentDefinition<Irf520ModuleProps> = {
  manifest,
  create: () => new Irf520Module(),
};
export { Irf520Module, type Irf520ModuleProps, type Irf520ModuleState } from './model.js';
export { manifest } from './manifest.js';
