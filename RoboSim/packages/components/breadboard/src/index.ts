import type { ComponentDefinition, ComponentManifest } from '@robosim/sim-core';
import { FULL, HALF, breadboardConnections, type BreadboardLayout } from './layout.js';
import { manifestFull, manifestHalf } from './manifest.js';
import { Breadboard, type BreadboardProps } from './model.js';

function define(manifest: ComponentManifest, layout: BreadboardLayout): ComponentDefinition<BreadboardProps> {
  const connections = breadboardConnections(layout);
  return { manifest, create: () => new Breadboard(manifest.id), internalConnections: () => connections };
}

export const breadboardHalf = define(manifestHalf, HALF);
export const breadboardFull = define(manifestFull, FULL);
export const definitions: readonly ComponentDefinition<BreadboardProps>[] = [breadboardHalf, breadboardFull];
export { Breadboard, type BreadboardProps } from './model.js';
export { FULL, HALF, breadboardConnections, breadboardPins, type BreadboardLayout } from './layout.js';
export { BREADBOARD_LAYOUTS } from './manifest.js';
