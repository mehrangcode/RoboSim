import type { ComponentDefinition } from '@robosim/sim-core';
import { manifest } from './manifest.js';
import { Tcrt5000, type Tcrt5000Props } from './model.js';

export const definition: ComponentDefinition<Tcrt5000Props> = { manifest, create: () => new Tcrt5000() };
export { Tcrt5000, type Tcrt5000Props, type Tcrt5000State } from './model.js';
export { manifest } from './manifest.js';
