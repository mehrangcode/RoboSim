import type { ComponentDefinition } from '@robosim/sim-core';
import { manifest } from './manifest.js';
import { OledSsd1306, type OledProps } from './model.js';

export const definition: ComponentDefinition<OledProps> = { manifest, create: () => new OledSsd1306() };
export {
  OLED_HEIGHT,
  OLED_WIDTH,
  OledSsd1306,
  Ssd1306,
  pixelAt,
  type OledProps,
  type OledState,
} from './model.js';
export { manifest } from './manifest.js';
