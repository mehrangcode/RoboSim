import type { ComponentDefinition } from '@robosim/sim-core';
import { manifest } from './manifest.js';
import { Line3ch, type Line3chProps } from './model.js';

export const definition: ComponentDefinition<Line3chProps> = { manifest, create: () => new Line3ch() };
export { Line3ch, type Channel, type Line3chProps, type Line3chState } from './model.js';
export { manifest } from './manifest.js';
