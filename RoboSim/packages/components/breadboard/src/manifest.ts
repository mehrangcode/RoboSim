import type { ComponentManifest } from '@robosim/sim-core';
import fullJson from './manifest-full.json' with { type: 'json' };
import halfJson from './manifest-half.json' with { type: 'json' };
import { FULL, HALF, breadboardPins, type BreadboardLayout } from './layout.js';

/** Engine-free entry (`./manifest`): editors read the catalogue and hole layout without the model. */
const define = (json: unknown, layout: BreadboardLayout): ComponentManifest => ({
  ...(json as ComponentManifest),
  pins: breadboardPins(layout),
});

export const manifestHalf = define(halfJson, HALF);
export const manifestFull = define(fullJson, FULL);
export const manifests: readonly ComponentManifest[] = [manifestHalf, manifestFull];
/** Hole layout per catalogue id. */
export const BREADBOARD_LAYOUTS: Readonly<Record<string, BreadboardLayout>> = {
  [manifestHalf.id]: HALF,
  [manifestFull.id]: FULL,
};
export { FULL, HALF, breadboardConnections, breadboardPins, type BreadboardLayout } from './layout.js';
