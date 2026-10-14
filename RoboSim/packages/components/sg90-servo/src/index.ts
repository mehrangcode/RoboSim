import type { ComponentDefinition, ComponentManifest } from '@robosim/sim-core';
import manifestJson from './manifest.json' with { type: 'json' };
import { Sg90Servo, type Sg90ServoProps } from './model.js';

export const manifest = manifestJson as ComponentManifest;
export const definition: ComponentDefinition<Sg90ServoProps> = { manifest, create: () => new Sg90Servo() };
export { Sg90Servo, type Sg90ServoProps, type Sg90ServoState } from './model.js';
