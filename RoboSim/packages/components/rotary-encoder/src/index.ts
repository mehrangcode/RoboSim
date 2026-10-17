import type { ComponentDefinition } from '@robosim/sim-core';
import { manifest } from './manifest.js';
import { RotaryEncoder, type RotaryEncoderProps } from './model.js';

export const definition: ComponentDefinition<RotaryEncoderProps> = {
  manifest,
  create: () => new RotaryEncoder(),
};
export { RotaryEncoder, type RotaryEncoderProps, type RotaryEncoderState } from './model.js';
export { manifest } from './manifest.js';
