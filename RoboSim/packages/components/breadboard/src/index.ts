import type { ComponentDefinition, ComponentManifest } from '@robosim/sim-core';
import fullJson from './manifest-full.json' with { type: 'json' };
import halfJson from './manifest-half.json' with { type: 'json' };
import {
  Breadboard,
  FULL,
  HALF,
  breadboardConnections,
  breadboardPins,
  type BreadboardLayout,
  type BreadboardProps,
} from './model.js';

function define(json: unknown, layout: BreadboardLayout): ComponentDefinition<BreadboardProps> {
  const manifest = { ...(json as unknown as ComponentManifest), pins: breadboardPins(layout) };
  const connections = breadboardConnections(layout);
  return { manifest, create: () => new Breadboard(manifest.id), internalConnections: () => connections };
}

export const breadboardHalf = define(halfJson, HALF);
export const breadboardFull = define(fullJson, FULL);
export const definitions: readonly ComponentDefinition<BreadboardProps>[] = [breadboardHalf, breadboardFull];
export {
  Breadboard,
  FULL,
  HALF,
  breadboardConnections,
  breadboardPins,
  type BreadboardLayout,
  type BreadboardProps,
} from './model.js';
