import type { ComponentDefinition } from '@robosim/sim-core';
import { manifest } from './manifest.js';
import { L9110s, type L9110sProps } from './model.js';

export const definition: ComponentDefinition<L9110sProps> = { manifest, create: () => new L9110s() };
export { L9110s, type L9110sMode, type L9110sProps, type L9110sState } from './model.js';
export { manifest } from './manifest.js';
