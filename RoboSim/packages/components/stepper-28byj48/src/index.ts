import type { ComponentDefinition } from '@robosim/sim-core';
import { manifest } from './manifest.js';
import { Stepper28byj48, type Stepper28byj48Props } from './model.js';

export const definition: ComponentDefinition<Stepper28byj48Props> = {
  manifest,
  create: () => new Stepper28byj48(),
};
export { Stepper28byj48, type Coil, type Stepper28byj48Props, type Stepper28byj48State } from './model.js';
export { manifest } from './manifest.js';
