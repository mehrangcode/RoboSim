import type { ComponentDefinition } from '@robosim/sim-core';
import {
  manifest2n2222,
  manifest2n3906,
  manifestBc547,
  manifestIrlz44n,
  manifestTip120,
} from './manifest.js';
import {
  Q_2N2222,
  Q_2N3906,
  Q_BC547,
  Q_IRLZ44N,
  Q_TIP120,
  Transistor,
  type TransistorProps,
  type TransistorVariant,
} from './model.js';

export {
  manifest2n2222,
  manifest2n3906,
  manifestBc547,
  manifestIrlz44n,
  manifestTip120,
} from './manifest.js';

const define = (manifest: ComponentDefinition['manifest'], variant: TransistorVariant) =>
  ({ manifest, create: () => new Transistor(variant) }) satisfies ComponentDefinition<TransistorProps>;

export const transistor2n2222 = define(manifest2n2222, Q_2N2222);
export const transistorBc547 = define(manifestBc547, Q_BC547);
export const transistor2n3906 = define(manifest2n3906, Q_2N3906);
export const transistorTip120 = define(manifestTip120, Q_TIP120);
export const mosfetIrlz44n = define(manifestIrlz44n, Q_IRLZ44N);

/** Discrete transistors sharing one model: four BJTs and a logic-level MOSFET. */
export const definitions: readonly ComponentDefinition<TransistorProps>[] = [
  transistor2n2222,
  transistorBc547,
  transistor2n3906,
  transistorTip120,
  mosfetIrlz44n,
];
export {
  Q_2N2222,
  Q_2N3906,
  Q_BC547,
  Q_IRLZ44N,
  Q_TIP120,
  Transistor,
  type TransistorProps,
  type TransistorState,
  type TransistorVariant,
} from './model.js';
