import type { ComponentDefinition } from '@robosim/sim-core';
import { manifest } from './manifest.js';
import { Sg90Servo, type Sg90ServoProps } from './model.js';

export const definition: ComponentDefinition<Sg90ServoProps> = { manifest, create: () => new Sg90Servo() };
export { Sg90Servo, type Sg90ServoProps, type Sg90ServoState } from './model.js';
export { manifest } from './manifest.js';
