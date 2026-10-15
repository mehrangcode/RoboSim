import type { ComponentDefinition } from '@robosim/sim-core';
import { manifest } from './manifest.js';
import { PushButton, type PushButtonProps } from './model.js';

export const definition: ComponentDefinition<PushButtonProps> = { manifest, create: () => new PushButton() };
export { PushButton, type PushButtonProps, type PushButtonState } from './model.js';
export { manifest } from './manifest.js';
