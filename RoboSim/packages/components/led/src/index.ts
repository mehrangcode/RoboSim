import type { ComponentDefinition, ComponentManifest } from '@robosim/sim-core';
import manifestJson from './manifest.json' with { type: 'json' };
import { Led, type LedProps } from './model.js';

export const manifest = manifestJson as unknown as ComponentManifest;
export const definition: ComponentDefinition<LedProps> = { manifest, create: () => new Led() };
export { Led, type LedColor, type LedProps, type LedState } from './model.js';
