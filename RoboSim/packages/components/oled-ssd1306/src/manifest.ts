import type { ComponentManifest } from '@robosim/sim-core';
import manifestJson from './manifest.json' with { type: 'json' };

/** Engine-free entry (`./manifest`): editors read the catalogue without loading the model. */
// JSON imports widen tuples/unions; validateManifest() in the package tests checks the shape.
export const manifest = manifestJson as unknown as ComponentManifest;
export const manifests: readonly ComponentManifest[] = [manifest];
