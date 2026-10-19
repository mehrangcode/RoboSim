import type { ComponentDefinition } from '@robosim/sim-core';
import { manifest } from './manifest.js';
import { Bmp280, type Bmp280Props } from './model.js';

export const definition: ComponentDefinition<Bmp280Props> = { manifest, create: () => new Bmp280() };
export {
  Bmp280,
  CALIBRATION,
  compensatePressure,
  compensateTemperature,
  rawPressureFor,
  rawTemperatureFor,
  type Bmp280Props,
  type Bmp280State,
} from './model.js';
export { manifest } from './manifest.js';
