import type { ComponentDefinition } from '@robosim/sim-core';
import { manifest } from './manifest.js';
import { Dht11, type Dht11Props } from './model.js';

export const definition: ComponentDefinition<Dht11Props> = { manifest, create: () => new Dht11() };
export { Dht11, type Dht11Props, type Dht11State } from './model.js';
export { manifest } from './manifest.js';
