import type { ComponentManifest } from '@robosim/sim-core';
import json4aa from './manifest-4aa.json' with { type: 'json' };
import json9v from './manifest-9v.json' with { type: 'json' };

/** Engine-free entry (`./manifest`): editors read the catalogue without loading the model. */
export const manifest9v = json9v as unknown as ComponentManifest;
export const manifest4aa = json4aa as unknown as ComponentManifest;
export const manifests: readonly ComponentManifest[] = [manifest9v, manifest4aa];
