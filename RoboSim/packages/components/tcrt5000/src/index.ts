import type { ComponentDefinition, ComponentManifest } from '@robosim/sim-core';
import manifestJson from './manifest.json' with { type: 'json' };
import { Tcrt5000, type Tcrt5000Props } from './model.js';

export const manifest = manifestJson as ComponentManifest;
export const definition: ComponentDefinition<Tcrt5000Props> = { manifest, create: () => new Tcrt5000() };
export { Tcrt5000, type Tcrt5000Props, type Tcrt5000State } from './model.js';
