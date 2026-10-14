import type { ComponentDefinition, ComponentManifest } from '@robosim/sim-core';
import manifestJson from './manifest.json' with { type: 'json' };
import { ActiveBuzzer, type ActiveBuzzerProps } from './model.js';

export const manifest = manifestJson as unknown as ComponentManifest;
export const definition: ComponentDefinition<ActiveBuzzerProps> = {
  manifest,
  create: () => new ActiveBuzzer(),
};
export { ActiveBuzzer, type ActiveBuzzerProps, type ActiveBuzzerState } from './model.js';
