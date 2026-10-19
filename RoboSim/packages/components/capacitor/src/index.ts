import type { ComponentDefinition } from '@robosim/sim-core';
import { manifestCeramic, manifestElectrolytic } from './manifest.js';
import { CERAMIC, Capacitor, ELECTROLYTIC, type CapacitorProps, type CapacitorVariant } from './model.js';

export { manifestCeramic, manifestElectrolytic } from './manifest.js';

const define = (manifest: ComponentDefinition['manifest'], variant: CapacitorVariant) =>
  ({ manifest, create: () => new Capacitor(variant) }) satisfies ComponentDefinition<CapacitorProps>;

export const ceramicCapacitor = define(manifestCeramic, CERAMIC);
export const electrolyticCapacitor = define(manifestElectrolytic, ELECTROLYTIC);

/** Ceramic and electrolytic capacitors share one model. */
export const definitions: readonly ComponentDefinition<CapacitorProps>[] = [
  ceramicCapacitor,
  electrolyticCapacitor,
];
export {
  CERAMIC,
  Capacitor,
  ELECTROLYTIC,
  electrolyticEsr,
  ratedVoltageOf,
  type CapacitorProps,
  type CapacitorState,
  type CapacitorVariant,
} from './model.js';
