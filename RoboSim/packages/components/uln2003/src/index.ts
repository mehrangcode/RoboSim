import type { ComponentDefinition } from '@robosim/sim-core';
import { manifest } from './manifest.js';
import { Uln2003a, type Uln2003Props } from './model.js';

export const definition: ComponentDefinition<Uln2003Props> = { manifest, create: () => new Uln2003a() };
export { Uln2003a, type Uln2003Props, type Uln2003State } from './model.js';
export { manifest } from './manifest.js';
