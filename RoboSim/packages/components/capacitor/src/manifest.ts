import type { ComponentManifest } from '@robosim/sim-core';
import ceramicJson from './manifest-ceramic.json' with { type: 'json' };
import electrolyticJson from './manifest-electrolytic.json' with { type: 'json' };

/** Engine-free entry (`./manifest`): editors read the catalogue without loading the model. */
export const manifestCeramic = ceramicJson as unknown as ComponentManifest;
export const manifestElectrolytic = electrolyticJson as unknown as ComponentManifest;
export const manifests: readonly ComponentManifest[] = [manifestCeramic, manifestElectrolytic];
