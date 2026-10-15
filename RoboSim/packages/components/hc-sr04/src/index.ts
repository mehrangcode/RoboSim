import type { ComponentDefinition } from '@robosim/sim-core';
import { manifest } from './manifest.js';
import { HcSr04, type HcSr04Props } from './model.js';

export const definition: ComponentDefinition<HcSr04Props> = { manifest, create: () => new HcSr04() };
export { HcSr04, type HcSr04Props, type HcSr04State } from './model.js';
export { manifest } from './manifest.js';
