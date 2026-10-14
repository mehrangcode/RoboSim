import type { ComponentDefinition, ComponentManifest } from '@robosim/sim-core';
import manifestJson from './manifest.json' with { type: 'json' };
import { PowerSwitch, type PowerSwitchProps } from './model.js';

export const manifest = manifestJson as ComponentManifest;
export const definition: ComponentDefinition<PowerSwitchProps> = {
  manifest,
  create: () => new PowerSwitch(),
};
export { PowerSwitch, type PowerSwitchProps, type PowerSwitchState } from './model.js';
