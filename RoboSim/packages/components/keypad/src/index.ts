import type { ComponentDefinition } from '@robosim/sim-core';
import { manifest } from './manifest.js';
import { Keypad, type KeypadProps } from './model.js';

export const definition: ComponentDefinition<KeypadProps> = { manifest, create: () => new Keypad() };
export { KEYPAD_LAYOUT, Keypad, keyInput, type KeypadProps, type KeypadState } from './model.js';
export { manifest } from './manifest.js';
