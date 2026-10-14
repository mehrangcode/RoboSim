import type { ComponentDefinition, ComponentManifest } from '@robosim/sim-core';
import manifestJson from './manifest.json' with { type: 'json' };
import { PushButton, type PushButtonProps } from './model.js';

export const manifest = manifestJson as unknown as ComponentManifest;
export const definition: ComponentDefinition<PushButtonProps> = { manifest, create: () => new PushButton() };
export { PushButton, type PushButtonProps, type PushButtonState } from './model.js';
