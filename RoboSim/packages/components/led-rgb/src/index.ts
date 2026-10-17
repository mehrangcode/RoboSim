import type { ComponentDefinition } from '@robosim/sim-core';
import { manifest } from './manifest.js';
import { RgbLed, type RgbLedProps } from './model.js';

export const definition: ComponentDefinition<RgbLedProps> = { manifest, create: () => new RgbLed() };
export { RgbLed, type RgbChannel, type RgbCommon, type RgbLedProps, type RgbLedState } from './model.js';
export { manifest } from './manifest.js';
