import type { ComponentDefinition } from '@robosim/sim-core';
import { manifestMg996r, manifestSg90 } from './manifest.js';
import { MG996R, SG90, Servo, type ServoProps } from './model.js';

export { manifestMg996r, manifestSg90 } from './manifest.js';

export const sg90: ComponentDefinition<ServoProps> = {
  manifest: manifestSg90,
  create: () => new Servo(SG90),
};
export const mg996r: ComponentDefinition<ServoProps> = {
  manifest: manifestMg996r,
  create: () => new Servo(MG996R),
};

/** This package ships two catalogue entries sharing one model. */
export const definitions: readonly ComponentDefinition<ServoProps>[] = [sg90, mg996r];
export { MG996R, SG90, Servo, type ServoProps, type ServoState, type ServoVariant } from './model.js';
