import type { ComponentDefinition } from '@robosim/sim-core';
import { manifest } from './manifest.js';
import { TtMotor, type TtMotorProps } from './model.js';

export const definition: ComponentDefinition<TtMotorProps> = { manifest, create: () => new TtMotor() };
export {
  TtMotor,
  type TtMotorProps,
  type TtMotorState,
  motorConstants,
  type MotorConstants,
} from './model.js';
export { manifest } from './manifest.js';
