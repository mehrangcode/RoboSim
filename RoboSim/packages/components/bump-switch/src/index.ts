import type { ComponentDefinition } from '@robosim/sim-core';
import { manifest } from './manifest.js';
import { BumpSwitch, type BumpSwitchProps } from './model.js';

export const definition: ComponentDefinition<BumpSwitchProps> = { manifest, create: () => new BumpSwitch() };
export { BumpSwitch, type BumpSwitchProps, type BumpSwitchState } from './model.js';
export { manifest } from './manifest.js';
