import type { ComponentDefinition } from '@robosim/sim-core';
import { manifest4aa, manifest9v } from './manifest.js';
import { Battery, type BatteryProps } from './model.js';

export { manifest4aa, manifest9v } from './manifest.js';

export const battery9v: ComponentDefinition<BatteryProps> = {
  manifest: manifest9v,
  create: () =>
    new Battery({ type: manifest9v.id, cells: 6, maxCurrentMa: manifest9v.limits['maxCurrentMa'] ?? 800 }),
};
export const battery4aa: ComponentDefinition<BatteryProps> = {
  manifest: manifest4aa,
  create: () =>
    new Battery({ type: manifest4aa.id, cells: 4, maxCurrentMa: manifest4aa.limits['maxCurrentMa'] ?? 3000 }),
};

/** This package ships two catalogue entries sharing one model. */
export const definitions: readonly ComponentDefinition<BatteryProps>[] = [battery9v, battery4aa];
export { Battery, cellOcv, type BatteryProps, type BatteryState, type BatteryVariant } from './model.js';
