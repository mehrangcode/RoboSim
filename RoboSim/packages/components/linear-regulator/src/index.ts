import type { ComponentDefinition } from '@robosim/sim-core';
import { manifestAms1117, manifestLm7805 } from './manifest.js';
import { AMS1117_3V3, LinearRegulator, LM7805, type LinearRegulatorProps } from './model.js';

export { manifestAms1117, manifestLm7805 } from './manifest.js';

export const lm7805: ComponentDefinition<LinearRegulatorProps> = {
  manifest: manifestLm7805,
  create: () => new LinearRegulator(LM7805),
};
export const ams1117: ComponentDefinition<LinearRegulatorProps> = {
  manifest: manifestAms1117,
  create: () => new LinearRegulator(AMS1117_3V3),
};

/** This package ships two catalogue entries sharing one model. */
export const definitions: readonly ComponentDefinition<LinearRegulatorProps>[] = [lm7805, ams1117];
export {
  AMS1117_3V3,
  LinearRegulator,
  LM7805,
  type LinearRegulatorProps,
  type LinearRegulatorState,
  type RegulatorVariant,
} from './model.js';
