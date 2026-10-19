import type { ComponentDefinition } from '@robosim/sim-core';
import { manifest } from './manifest.js';
import { Lcd1602I2c, type LcdProps } from './model.js';

export const definition: ComponentDefinition<LcdProps> = { manifest, create: () => new Lcd1602I2c() };
export { Hd44780, Lcd1602I2c, type LcdProps, type LcdState } from './model.js';
export { manifest } from './manifest.js';
