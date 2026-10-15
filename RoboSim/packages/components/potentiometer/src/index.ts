import type { ComponentDefinition } from '@robosim/sim-core';
import { manifest } from './manifest.js';
import { Potentiometer, type PotentiometerProps } from './model.js';

export const definition: ComponentDefinition<PotentiometerProps> = {
  manifest,
  create: () => new Potentiometer(),
};
export { Potentiometer, type PotentiometerProps, type PotentiometerState } from './model.js';
export { manifest } from './manifest.js';
