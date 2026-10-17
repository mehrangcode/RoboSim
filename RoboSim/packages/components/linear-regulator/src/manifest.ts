import type { ComponentManifest } from '@robosim/sim-core';
import jsonAms1117 from './manifest-ams1117-3v3.json' with { type: 'json' };
import jsonLm7805 from './manifest-lm7805.json' with { type: 'json' };

/** Engine-free entry (`./manifest`): editors read the catalogue without loading the model. */
export const manifestLm7805 = jsonLm7805 as unknown as ComponentManifest;
export const manifestAms1117 = jsonAms1117 as unknown as ComponentManifest;
export const manifests: readonly ComponentManifest[] = [manifestLm7805, manifestAms1117];
