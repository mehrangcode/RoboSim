import type { ComponentManifest } from '@robosim/sim-core';
import json00 from './manifest-74hc00.json' with { type: 'json' };
import json08 from './manifest-74hc08.json' with { type: 'json' };
import json14 from './manifest-74hc14.json' with { type: 'json' };
import json32 from './manifest-74hc32.json' with { type: 'json' };
import json86 from './manifest-74hc86.json' with { type: 'json' };

/** Engine-free entry (`./manifest`): editors read the catalogue without loading the model. */
export const manifest74hc00 = json00 as unknown as ComponentManifest;
export const manifest74hc08 = json08 as unknown as ComponentManifest;
export const manifest74hc32 = json32 as unknown as ComponentManifest;
export const manifest74hc86 = json86 as unknown as ComponentManifest;
export const manifest74hc14 = json14 as unknown as ComponentManifest;
export const manifests: readonly ComponentManifest[] = [
  manifest74hc00,
  manifest74hc08,
  manifest74hc32,
  manifest74hc86,
  manifest74hc14,
];
