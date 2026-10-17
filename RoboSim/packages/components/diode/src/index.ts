import type { ComponentDefinition } from '@robosim/sim-core';
import { manifest1n4007, manifest1n4148, manifestZener5v1 } from './manifest.js';
import {
  Diode,
  VARIANT_1N4007,
  VARIANT_1N4148,
  VARIANT_ZENER_5V1,
  type DiodeProps,
  type DiodeVariant,
} from './model.js';

export { manifest1n4007, manifest1n4148, manifestZener5v1 } from './manifest.js';

const define = (manifest: ComponentDefinition['manifest'], variant: DiodeVariant) =>
  ({ manifest, create: () => new Diode(variant) }) satisfies ComponentDefinition<DiodeProps>;

export const diode1n4007 = define(manifest1n4007, VARIANT_1N4007);
export const diode1n4148 = define(manifest1n4148, VARIANT_1N4148);
export const zener5v1 = define(manifestZener5v1, VARIANT_ZENER_5V1);

/** This package ships three catalogue entries sharing one model. */
export const definitions: readonly ComponentDefinition<DiodeProps>[] = [diode1n4007, diode1n4148, zener5v1];
export {
  Diode,
  VARIANT_1N4007,
  VARIANT_1N4148,
  VARIANT_ZENER_5V1,
  type DiodeProps,
  type DiodeState,
  type DiodeVariant,
} from './model.js';
