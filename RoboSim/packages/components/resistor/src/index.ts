import type { ComponentDefinition } from '@robosim/sim-core';
import { manifest } from './manifest.js';
import { Resistor, type ResistorProps } from './model.js';

export const definition: ComponentDefinition<ResistorProps> = { manifest, create: () => new Resistor() };
export { Resistor, type ResistorProps, type ResistorState } from './model.js';
export { manifest } from './manifest.js';
