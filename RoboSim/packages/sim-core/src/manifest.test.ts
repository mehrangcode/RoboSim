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
});
