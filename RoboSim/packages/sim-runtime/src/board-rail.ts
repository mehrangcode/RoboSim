import type { ComponentDefinition, ComponentModel, NetId } from '@robosim/sim-core';

/**
 * The Uno's 5 V pin as a stiff supply, until the board power tree is part of the netlist.
 * Internal to demo scenarios; not a catalogue component.
 */
export const unoFiveVolt: ComponentDefinition = {
  manifest: {
    id: 'board.uno-5v',
    version: '1.0.0',
    category: 'power',
    tier: 'basic',
    phase: 'P1',
    nameKey: 'board.uno-5v.name',
    pins: [
      { name: 'pos', kind: 'power' },
      { name: 'neg', kind: 'ground' },
    ],
    props: {},
    inputs: [],
    massG: 0,
    limits: {},
    traits: ['source'],
    supplyPins: [{ pin: 'pos', maxCurrentMa: 500 }], // USB polyfuse
  },
  create(): ComponentModel {
    let pos: NetId = 0;
    let neg: NetId = 0;
    return {
      type: 'board.uno-5v',
      init(ctx) {
        pos = ctx.net('pos');
        neg = ctx.net('neg');
      },
      stamp: (s) => void s.voltageSource(pos, neg, 5, 0.1),
      step: () => undefined,
      faults: () => [],
      snapshot: () => null,
    };
  },
};
