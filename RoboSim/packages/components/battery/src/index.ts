import type { ComponentDefinition, ComponentManifest } from '@robosim/sim-core';
import json4aa from './manifest-4aa.json' with { type: 'json' };
import json9v from './manifest-9v.json' with { type: 'json' };
import { Battery, type BatteryProps } from './model.js';

export const manifest9v = json9v as ComponentManifest;
export const manifest4aa = json4aa as ComponentManifest;

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
