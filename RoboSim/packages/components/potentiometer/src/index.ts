import type { ComponentDefinition, ComponentManifest } from '@robosim/sim-core';
import manifestJson from './manifest.json' with { type: 'json' };
import { Potentiometer, type PotentiometerProps } from './model.js';

export const manifest = manifestJson as ComponentManifest;
export const definition: ComponentDefinition<PotentiometerProps> = {
  manifest,
  create: () => new Potentiometer(),
};
export { Potentiometer, type PotentiometerProps, type PotentiometerState } from './model.js';
