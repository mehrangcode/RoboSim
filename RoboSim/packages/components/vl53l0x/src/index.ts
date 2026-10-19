import type { ComponentDefinition } from '@robosim/sim-core';
import { manifest } from './manifest.js';
import { Vl53l0x, type Vl53l0xProps } from './model.js';

export const definition: ComponentDefinition<Vl53l0xProps> = { manifest, create: () => new Vl53l0x() };
export { REG, Vl53l0x, measurementTimingBudgetUs, type Vl53l0xProps, type Vl53l0xState } from './model.js';
export { manifest } from './manifest.js';
