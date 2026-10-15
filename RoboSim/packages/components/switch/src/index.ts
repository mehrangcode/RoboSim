import type { ComponentDefinition } from '@robosim/sim-core';
import { manifest } from './manifest.js';
import { PowerSwitch, type PowerSwitchProps } from './model.js';

export const definition: ComponentDefinition<PowerSwitchProps> = {
  manifest,
  create: () => new PowerSwitch(),
};
export { PowerSwitch, type PowerSwitchProps, type PowerSwitchState } from './model.js';
export { manifest } from './manifest.js';
