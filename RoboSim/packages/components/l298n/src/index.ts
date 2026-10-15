import type { ComponentDefinition } from '@robosim/sim-core';
import { manifest } from './manifest.js';
import { L298n, type L298nProps } from './model.js';

export const definition: ComponentDefinition<L298nProps> = { manifest, create: () => new L298n() };
export { L298n, type BridgeMode, type L298nProps, type L298nState } from './model.js';
export { manifest } from './manifest.js';
