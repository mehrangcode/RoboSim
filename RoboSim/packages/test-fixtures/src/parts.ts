import type {
  ComponentDefinition,
  ComponentModel,
  MnaStamper,
  ModelContext,
  NetId,
  ReactiveState,
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
    traits: ['source'],
    supplyPins: [{ pin: 'pos', maxCurrentMa: 500 }],
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

/** Ideal capacitor for component tests (reactive circuits integrate in time steps). */
export const fixedCapacitor: ComponentDefinition<{ farads: number }> = {
  manifest: {
    id: 'test.capacitor',
    version: '1.0.0',
    category: 'passive',
    tier: 'basic',
    phase: 'P1',
    nameKey: 'test.capacitor.name',
    pins: [
      { name: 'a', kind: 'passive' },
      { name: 'b', kind: 'passive' },
    ],
    props: { farads: { type: 'number', default: 1e-6, min: 1e-12 } },
    inputs: [],
    massG: 0,
    limits: {},
  },
  create(): ComponentModel<{ farads: number }, ReactiveState> {
    let a: NetId = 0;
    let b: NetId = 0;
    let farads = 1e-6;
    const state: ReactiveState = { volts: 0, amps: 0 };
    return {
      type: 'test.capacitor',
      init(ctx, p) {
        a = ctx.net('a');
        b = ctx.net('b');
        farads = p.farads;
      },
      stamp: (s) => {
        s.capacitor(a, b, farads, state);
      },
      step() {},
      faults: () => [],
      snapshot: () => ({ ...state }),
    };
  },
};

/** Coil for component tests: inductance in series with its winding resistance. */
export const fixedInductor: ComponentDefinition<{ henries: number; ohms: number }> = {
  manifest: {
    id: 'test.inductor',
    version: '1.0.0',
    category: 'passive',
    tier: 'basic',
    phase: 'P1',
    nameKey: 'test.inductor.name',
    pins: [
      { name: 'a', kind: 'power' },
      { name: 'b', kind: 'power' },
    ],
    props: {
      henries: { type: 'number', default: 0.01, min: 1e-9 },
      ohms: { type: 'number', default: 10, min: 0 },
    },
    inputs: [],
    massG: 0,
    traits: ['inductive'],
    limits: {},
  },
  create(): ComponentModel<{ henries: number; ohms: number }, ReactiveState> {
    let a: NetId = 0;
    let b: NetId = 0;
    let props = { henries: 0.01, ohms: 10 };
    const state: ReactiveState = { volts: 0, amps: 0 };
    return {
      type: 'test.inductor',
      init(ctx, p) {
        a = ctx.net('a');
        b = ctx.net('b');
        props = p;
      },
      stamp: (s) => {
        s.inductor(a, b, props.henries, state, { seriesResistance: props.ohms });
      },
      step() {},
      faults: () => [],
      snapshot: () => ({ ...state }),
    };
  },
};

/** Plain PWL diode for component tests (a flyback clamp): 0.7 V knee, 0.2 Ω. */
export const fixedDiode: ComponentDefinition<Record<string, never>> = {
  manifest: {
    id: 'test.diode',
    version: '1.0.0',
    category: 'semiconductor',
    tier: 'basic',
    phase: 'P1',
    nameKey: 'test.diode.name',
    pins: [
      { name: 'a', kind: 'passive' },
      { name: 'k', kind: 'passive' },
    ],
    props: {},
    inputs: [],
    massG: 0,
    limits: {},
  },
  create(): ComponentModel<Record<string, never>, null> {
    let a: NetId = 0;
    let k: NetId = 0;
    return {
      type: 'test.diode',
      init(ctx) {
        a = ctx.net('a');
        k = ctx.net('k');
      },
      stamp: (s) => {
        s.diode(a, k, { vf: 0.7, rs: 0.2 });
      },
      step() {},
      faults: () => [],
      snapshot: () => null,
    };
  },
};
