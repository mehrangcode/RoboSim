import type { ComponentDefinition, ComponentManifest } from '@robosim/sim-core';
import manifestJson from './manifest.json' with { type: 'json' };
import { TtMotor, type TtMotorProps } from './model.js';

export const manifest = manifestJson as unknown as ComponentManifest;
export const definition: ComponentDefinition<TtMotorProps> = { manifest, create: () => new TtMotor() };
export {
  TtMotor,
  type TtMotorProps,
  type TtMotorState,
  motorConstants,
  type MotorConstants,
} from './model.js';
