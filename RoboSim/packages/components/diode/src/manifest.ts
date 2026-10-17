import type { ComponentManifest } from '@robosim/sim-core';
import json1n4007 from './manifest-1n4007.json' with { type: 'json' };
import json1n4148 from './manifest-1n4148.json' with { type: 'json' };
import jsonZener from './manifest-zener-5v1.json' with { type: 'json' };

/** Engine-free entry (`./manifest`): editors read the catalogue without loading the model. */
export const manifest1n4007 = json1n4007 as unknown as ComponentManifest;
export const manifest1n4148 = json1n4148 as unknown as ComponentManifest;
export const manifestZener5v1 = jsonZener as unknown as ComponentManifest;
export const manifests: readonly ComponentManifest[] = [manifest1n4007, manifest1n4148, manifestZener5v1];
