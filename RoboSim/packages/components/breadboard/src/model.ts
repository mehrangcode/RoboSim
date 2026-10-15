import type { ComponentIO, ComponentModel, Fault, MnaStamper, ModelContext } from '@robosim/sim-core';

export type BreadboardProps = Record<string, never>;

/** Solderless breadboard: purely topological (strips merge in the netlist), no electrical stamp. */
export class Breadboard implements ComponentModel<BreadboardProps, null> {
  constructor(readonly type: string) {}

  init(_ctx: ModelContext): void {}

  stamp(_s: MnaStamper): void {}

  step(_dt: number, _io: ComponentIO): void {}

  faults(): readonly Fault[] {
    return [];
  }

  snapshot(): null {
    return null;
  }
}
