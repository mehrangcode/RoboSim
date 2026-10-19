import type { ComponentManifest } from '@robosim/sim-core';
import json2n2222 from './manifest-2n2222.json' with { type: 'json' };
import json2n3906 from './manifest-2n3906.json' with { type: 'json' };
import jsonBc547 from './manifest-bc547.json' with { type: 'json' };
import jsonIrlz44n from './manifest-irlz44n.json' with { type: 'json' };
import jsonTip120 from './manifest-tip120.json' with { type: 'json' };

/** Engine-free entry (`./manifest`): editors read the catalogue without loading the model. */
export const manifest2n2222 = json2n2222 as unknown as ComponentManifest;
export const manifestBc547 = jsonBc547 as unknown as ComponentManifest;
export const manifest2n3906 = json2n3906 as unknown as ComponentManifest;
export const manifestTip120 = jsonTip120 as unknown as ComponentManifest;
export const manifestIrlz44n = jsonIrlz44n as unknown as ComponentManifest;
export const manifests: readonly ComponentManifest[] = [
  manifest2n2222,
  manifestBc547,
  manifest2n3906,
  manifestTip120,
  manifestIrlz44n,
];
