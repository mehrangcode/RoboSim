import type { ComponentDefinition, ComponentManifest } from '@robosim/sim-core';
import {
  manifest74hc00,
  manifest74hc08,
  manifest74hc14,
  manifest74hc32,
  manifest74hc86,
} from './manifest.js';
import {
  GateArray,
  HC00,
  HC08,
  HC14,
  HC32,
  HC86,
  type GateArrayProps,
  type GateArrayVariant,
} from './model.js';

export {
  manifest74hc00,
  manifest74hc08,
  manifest74hc14,
  manifest74hc32,
  manifest74hc86,
} from './manifest.js';

const define = (
  manifest: ComponentManifest,
  variant: GateArrayVariant,
): ComponentDefinition<GateArrayProps> => ({
  manifest,
  create: () => new GateArray(variant),
});

export const hc00 = define(manifest74hc00, HC00);
export const hc08 = define(manifest74hc08, HC08);
export const hc32 = define(manifest74hc32, HC32);
export const hc86 = define(manifest74hc86, HC86);
export const hc14 = define(manifest74hc14, HC14);

/** This package ships five catalogue entries sharing one model. */
export const definitions: readonly ComponentDefinition<GateArrayProps>[] = [hc00, hc08, hc32, hc86, hc14];
export {
  GateArray,
  HC00,
  HC08,
  HC14,
  HC32,
  HC86,
  type GateArrayProps,
  type GateArrayState,
  type GateArrayVariant,
} from './model.js';
