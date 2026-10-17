import type { ComponentDefinition } from '@robosim/sim-core';
import { manifest } from './manifest.js';
import { SoundSensor, type SoundSensorProps } from './model.js';

export const definition: ComponentDefinition<SoundSensorProps> = {
  manifest,
  create: () => new SoundSensor(),
};
export { SoundSensor, type SoundSensorProps, type SoundSensorState } from './model.js';
export { manifest } from './manifest.js';
