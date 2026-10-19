import type { ComponentDefinition } from '@robosim/sim-core';
import { manifest } from './manifest.js';
import { Ds18b20, type Ds18b20Props } from './model.js';

export const definition: ComponentDefinition<Ds18b20Props> = { manifest, create: () => new Ds18b20() };
export { Ds18b20, crc8, type Ds18b20Props, type Ds18b20State } from './model.js';
export { manifest } from './manifest.js';
