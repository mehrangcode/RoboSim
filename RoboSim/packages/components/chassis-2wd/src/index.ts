import type { ComponentDefinition, ComponentManifest } from '@robosim/sim-core';
import manifestJson from './manifest.json' with { type: 'json' };
import { Chassis2wd, type Chassis2wdProps } from './model.js';

export const manifest = manifestJson as unknown as ComponentManifest;
export const definition: ComponentDefinition<Chassis2wdProps> = { manifest, create: () => new Chassis2wd() };
export {
  Chassis2wd,
  chassisGeometry,
  type ChassisGeometry,
  type Chassis2wdProps,
  type Chassis2wdState,
  type MountSlot,
} from './model.js';
