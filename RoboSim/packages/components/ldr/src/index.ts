import type { ComponentDefinition, ComponentManifest } from '@robosim/sim-core';
import manifestJson from './manifest.json' with { type: 'json' };
import { Ldr, type LdrProps } from './model.js';

export const manifest = manifestJson as ComponentManifest;
export const definition: ComponentDefinition<LdrProps> = { manifest, create: () => new Ldr() };
export { Ldr, type LdrProps, type LdrState } from './model.js';
