import type { ComponentManifest } from '@robosim/sim-core';
import jsonMg996r from './manifest-mg996r.json' with { type: 'json' };
import jsonSg90 from './manifest-sg90.json' with { type: 'json' };

/** Engine-free entry (`./manifest`): editors read the catalogue without loading the model. */
export const manifestSg90 = jsonSg90 as unknown as ComponentManifest;
export const manifestMg996r = jsonMg996r as unknown as ComponentManifest;
export const manifests: readonly ComponentManifest[] = [manifestSg90, manifestMg996r];
