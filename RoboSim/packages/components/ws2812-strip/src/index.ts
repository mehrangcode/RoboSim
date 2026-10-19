import type { ComponentDefinition } from '@robosim/sim-core';
import { manifest } from './manifest.js';
import { Ws2812Strip, type Ws2812Props } from './model.js';

export const definition: ComponentDefinition<Ws2812Props> = { manifest, create: () => new Ws2812Strip() };
export { Ws2812Strip, type Ws2812Props, type Ws2812State } from './model.js';
export { manifest } from './manifest.js';
