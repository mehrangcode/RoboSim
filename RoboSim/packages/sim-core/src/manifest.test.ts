import { describe, expect, it } from 'vitest';
import type { ComponentManifest } from './contracts.js';
import { resolveProps, validateManifest } from './manifest.js';

const manifest: ComponentManifest = {
  id: 'passive.resistor',
  version: '1.0.0',
  category: 'passive',
  tier: 'basic',
  phase: 'P1',
  nameKey: 'passive.resistor.name',
  pins: [
    { name: 'a', kind: 'passive' },
    { name: 'b', kind: 'passive' },
  ],
  props: {
    ohms: { type: 'number', default: 220, min: 0.1, max: 10_000_000, unit: 'Ω' },
    tolerance: { type: 'enum', default: '5%', options: ['1%', '5%'] },
    smd: { type: 'boolean', default: false },
  },
  inputs: [],
  massG: 0.3,
  limits: { maxPowerMw: 250 },
};

describe('resolveProps', () => {
  it('fills defaults and keeps given values', () => {
    expect(resolveProps(manifest, { ohms: 1000 })).toEqual({ ohms: 1000, tolerance: '5%', smd: false });
  });

  it('rejects unknown keys, wrong types, out-of-range numbers and bad enum values', () => {
    expect(() => resolveProps(manifest, { color: 'red' })).toThrow(/unknown property/);
    expect(() => resolveProps(manifest, { ohms: 'big' })).toThrow(/finite number/);
    expect(() => resolveProps(manifest, { ohms: 0 })).toThrow(/≥ 0.1/);
    expect(() => resolveProps(manifest, { tolerance: '10%' })).toThrow(/one of/);
    expect(() => resolveProps(manifest, { smd: 1 })).toThrow(/boolean/);
  });
});

describe('validateManifest', () => {
  it('accepts a well-formed manifest', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('reports structural problems', () => {
    const bad: ComponentManifest = {
      ...manifest,
      id: 'Resistor',
      version: 'v1',
      pins: [
        { name: 'a', kind: 'passive' },
        { name: 'a', kind: 'passive' },
      ],
      props: { ohms: { type: 'number', default: -1, min: 0 } },
      inputs: [{ name: 'pressed', type: 'boolean', default: 0 }],
    };
    expect(validateManifest(bad)).toHaveLength(6);
  });

  it('checks safety metadata references real pins', () => {
    const bad: ComponentManifest = {
      ...manifest,
      polarity: ['a', 'x'],
      supplyPins: [{ pin: 'y', maxCurrentMa: 10, enabledByProp: 'ohms' }],
      pinMaxVolts: { z: 5 },
    };
    expect(validateManifest(bad)).toEqual([
      "polarity pin 'x' does not exist",
      "supply pin 'y' does not exist",
      "supply pin 'y': enabledByProp 'ohms' must be a boolean prop",
      "pinMaxVolts pin 'z' does not exist",
    ]);
  });

  it('checks the power-budget limits are ≥ 0 (TD §18.4, ADR-028)', () => {
    const bad: ComponentManifest = {
      ...manifest,
      limits: { typicalCurrentMa: -1, idleCurrentMa: Number.NaN, minSupplyV: 3, dropoutV: -0.5 },
    };
    expect(validateManifest(bad)).toEqual([
      'limits.typicalCurrentMa must be ≥ 0',
      'limits.idleCurrentMa must be ≥ 0',
      'limits.dropoutV must be ≥ 0',
    ]);
  });

  it('checks the display-only voltage keys are > 0 (TD §18.6)', () => {
    const bad: ComponentManifest = {
      ...manifest,
      limits: { ratedVoltageV: 0, nominalVoltageV: -9, forwardVoltageV: Number.NaN },
    };
    expect(validateManifest(bad)).toEqual([
      'limits.ratedVoltageV must be > 0',
      'limits.nominalVoltageV must be > 0',
      'limits.forwardVoltageV must be > 0',
    ]);
  });

  it('checks function ids are kebab-case and functions/interfaces have no duplicates (TD §18.6)', () => {
    expect(
      validateManifest({
        ...manifest,
        functions: ['limit-current', 'divide-voltage'],
        interfaces: ['analog'],
      }),
    ).toEqual([]);
    const bad = {
      ...manifest,
      functions: ['Limit_Current', 'limit-current', 'limit-current'],
      interfaces: ['analog', 'analog', 'spi'],
    } as unknown as ComponentManifest;
    expect(validateManifest(bad)).toEqual([
      "function id 'Limit_Current' is not kebab-case",
      'functions has duplicates',
      "unknown interface 'spi'",
      'interfaces has duplicates',
    ]);
  });
});
