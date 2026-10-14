import type {
  ComponentDefinition,
  ComponentModel,
  MnaStamper,
  ModelContext,
  NetId,
  SourceHandle,
} from '@robosim/sim-core';

/** Ideal-ish bench supply for component tests: `volts` between pos and neg with `ohms` internal resistance. */
export const dcSupply: ComponentDefinition<{ volts: number; ohms: number }> = {
  manifest: {
    id: 'test.dc-supply',
    version: '1.0.0',
    category: 'power',
    tier: 'basic',
    phase: 'P1',
    nameKey: 'test.dc-supply.name',
    pins: [
      { name: 'pos', kind: 'power' },
      { name: 'neg', kind: 'ground' },
    ],
    props: {
      volts: { type: 'number', default: 5 },
      ohms: { type: 'number', default: 0.01, min: 0 },
    },
    inputs: [{ name: 'volts', type: 'number', default: 5 }],
    massG: 0,
    limits: {},
  },
  create(): ComponentModel<{ volts: number; ohms: number }, { currentMa: number }> {
    let pos: NetId = 0;
    let neg: NetId = 0;
    let props = { volts: 5, ohms: 0.01 };
    let handle = 0 as SourceHandle;
    let currentA = 0;
    return {
      type: 'test.dc-supply',
      init(ctx: ModelContext, p) {
        pos = ctx.net('pos');
        neg = ctx.net('neg');
        props = { ...p };
      },
      stamp(s: MnaStamper) {
        handle = s.voltageSource(pos, neg, props.volts, props.ohms);
      },
      step(_dt, io) {
        currentA = io.solution.sourceCurrent(handle);
      },
      faults: () => [],
      snapshot: () => ({ currentMa: currentA * 1000 }),
      input(name, value) {
        if (name === 'volts' && typeof value === 'number') props = { ...props, volts: value };
      },
    };
  },
};

/** Plain resistor for component tests (packages must not import each other's components). */
export const fixedResistor: ComponentDefinition<{ ohms: number }> = {
  manifest: {
    id: 'test.resistor',
    version: '1.0.0',
    category: 'passive',
    tier: 'basic',
    phase: 'P1',
    nameKey: 'test.resistor.name',
    pins: [
      { name: 'a', kind: 'passive' },
      { name: 'b', kind: 'passive' },
    ],
    props: { ohms: { type: 'number', default: 1000, min: 0.001 } },
    inputs: [],
    massG: 0,
    limits: {},
  },
  create(): ComponentModel<{ ohms: number }, { currentMa: number }> {
    let a: NetId = 0;
    let b: NetId = 0;
    let ohms = 1000;
    let currentA = 0;
    return {
      type: 'test.resistor',
      init(ctx, p) {
        a = ctx.net('a');
        b = ctx.net('b');
        ohms = p.ohms;
      },
      stamp: (s) => s.conductance(a, b, 1 / ohms),
      step(_dt, io) {
        currentA = (io.solution.voltage(a) - io.solution.voltage(b)) / ohms;
      },
      faults: () => [],
      snapshot: () => ({ currentMa: currentA * 1000 }),
    };
  },
};
