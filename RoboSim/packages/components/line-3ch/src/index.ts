import type { ComponentDefinition, ComponentManifest } from '@robosim/sim-core';
import manifestJson from './manifest.json' with { type: 'json' };
import { Line3ch, type Line3chProps } from './model.js';

export const manifest = manifestJson as ComponentManifest;
export const definition: ComponentDefinition<Line3chProps> = { manifest, create: () => new Line3ch() };
export { Line3ch, type Channel, type Line3chProps, type Line3chState } from './model.js';
