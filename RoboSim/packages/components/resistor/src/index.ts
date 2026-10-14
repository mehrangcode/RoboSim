import type { ComponentDefinition, ComponentManifest } from '@robosim/sim-core';
import manifestJson from './manifest.json' with { type: 'json' };
import { Resistor, type ResistorProps } from './model.js';

export const manifest = manifestJson as ComponentManifest;
export const definition: ComponentDefinition<ResistorProps> = { manifest, create: () => new Resistor() };
export { Resistor, type ResistorProps, type ResistorState } from './model.js';
