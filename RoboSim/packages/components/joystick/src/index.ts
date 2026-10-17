import type { ComponentDefinition } from '@robosim/sim-core';
import { manifest } from './manifest.js';
import { Joystick, type JoystickProps } from './model.js';

export const definition: ComponentDefinition<JoystickProps> = { manifest, create: () => new Joystick() };
export { Joystick, type JoystickProps, type JoystickState } from './model.js';
export { manifest } from './manifest.js';
