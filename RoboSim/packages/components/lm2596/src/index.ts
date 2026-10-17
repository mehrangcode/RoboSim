import type { ComponentDefinition } from '@robosim/sim-core';
import { manifest } from './manifest.js';
import { Lm2596, type Lm2596Props } from './model.js';

export const definition: ComponentDefinition<Lm2596Props> = {
  manifest,
  create: () => new Lm2596(),
};
export { Lm2596, type Lm2596Props, type Lm2596State } from './model.js';
export { manifest } from './manifest.js';
