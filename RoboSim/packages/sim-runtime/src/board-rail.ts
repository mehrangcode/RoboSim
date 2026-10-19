import type { ComponentDefinition, ComponentModel, NetId } from '@robosim/sim-core';

/**
 * A board supply pin as a stiff source, until the board power tree is part of the netlist.
 * Internal to the project loader; not a catalogue component.
 */
function rail(id: string, volts: number, ohms: number, maxCurrentMa: number): ComponentDefinition {
  return {
    manifest: {
      id,
      version: '1.0.0',
      category: 'power',
      tier: 'basic',
      phase: 'P1',
      nameKey: `${id}.name`,
      pins: [
        { name: 'pos', kind: 'power' },
        { name: 'neg', kind: 'ground' },
      ],
      props: {},
      inputs: [],
      massG: 0,
      limits: {},
      traits: ['source'],
      supplyPins: [{ pin: 'pos', maxCurrentMa }],
    },
    create(): ComponentModel {
      let pos: NetId = 0;
      let neg: NetId = 0;
      return {
        type: id,
        init(ctx) {
          pos = ctx.net('pos');
          neg = ctx.net('neg');
        },
        stamp: (s) => void s.voltageSource(pos, neg, volts, ohms),
        step: () => undefined,
        faults: () => [],
        snapshot: () => null,
      };
    },
  };
}

/** The Uno's 5 V pin, limited by the USB polyfuse. */
export const unoFiveVolt = rail('board.uno-5v', 5, 0.1, 500);
/** The Uno's 3.3 V pin: the LP2985 regulator fed from 5 V (150 mA). */
export const unoThreeVolt = rail('board.uno-3v3', 3.3, 0.5, 150);
