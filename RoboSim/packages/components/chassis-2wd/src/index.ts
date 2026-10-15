import type { ComponentDefinition } from '@robosim/sim-core';
import { manifest } from './manifest.js';
import { Chassis2wd, type Chassis2wdProps } from './model.js';

export const definition: ComponentDefinition<Chassis2wdProps> = { manifest, create: () => new Chassis2wd() };
export {
  Chassis2wd,
  chassisGeometry,
  type ChassisGeometry,
  type Chassis2wdProps,
  type Chassis2wdState,
  type MountSlot,
} from './model.js';
export { manifest } from './manifest.js';
