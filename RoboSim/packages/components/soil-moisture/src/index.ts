import type { ComponentDefinition } from '@robosim/sim-core';
import { manifest } from './manifest.js';
import { SoilMoisture, type SoilMoistureProps } from './model.js';

export const definition: ComponentDefinition<SoilMoistureProps> = {
  manifest,
  create: () => new SoilMoisture(),
};
export { SoilMoisture, type SoilMoistureProps, type SoilMoistureState } from './model.js';
export { manifest } from './manifest.js';
