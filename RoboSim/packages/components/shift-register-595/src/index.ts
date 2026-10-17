import type { ComponentDefinition } from '@robosim/sim-core';
import { manifest } from './manifest.js';
import { ShiftRegister595, type ShiftRegisterProps } from './model.js';

export const definition: ComponentDefinition<ShiftRegisterProps> = {
  manifest,
  create: () => new ShiftRegister595(),
};
export { ShiftRegister595, type ShiftRegisterProps, type ShiftRegisterState } from './model.js';
export { manifest } from './manifest.js';
