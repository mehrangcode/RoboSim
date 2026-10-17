import type { ComponentDefinition } from '@robosim/sim-core';
import { manifest } from './manifest.js';
import { Line5ch, type Line5chProps } from './model.js';

export const definition: ComponentDefinition<Line5chProps> = { manifest, create: () => new Line5ch() };
export { Line5ch, type Channel, type Line5chProps, type Line5chState } from './model.js';
export { manifest } from './manifest.js';
