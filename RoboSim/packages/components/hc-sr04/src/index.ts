import type { ComponentDefinition, ComponentManifest } from '@robosim/sim-core';
import manifestJson from './manifest.json' with { type: 'json' };
import { HcSr04, type HcSr04Props } from './model.js';

export const manifest = manifestJson as unknown as ComponentManifest;
export const definition: ComponentDefinition<HcSr04Props> = { manifest, create: () => new HcSr04() };
export { HcSr04, type HcSr04Props, type HcSr04State } from './model.js';
