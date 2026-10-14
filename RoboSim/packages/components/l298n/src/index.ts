import type { ComponentDefinition, ComponentManifest } from '@robosim/sim-core';
import manifestJson from './manifest.json' with { type: 'json' };
import { L298n, type L298nProps } from './model.js';

export const manifest = manifestJson as unknown as ComponentManifest;
export const definition: ComponentDefinition<L298nProps> = { manifest, create: () => new L298n() };
export { L298n, type BridgeMode, type L298nProps, type L298nState } from './model.js';
