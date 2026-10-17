import type { ComponentDefinition } from '@robosim/sim-core';
import { manifest } from './manifest.js';
import { Tb6612, type Tb6612Props } from './model.js';

export const definition: ComponentDefinition<Tb6612Props> = { manifest, create: () => new Tb6612() };
export { Tb6612, type Tb6612Mode, type Tb6612Props, type Tb6612State } from './model.js';
export { manifest } from './manifest.js';
