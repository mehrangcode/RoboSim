import { resources } from '@robosim/i18n';
import { validateManifest } from '@robosim/sim-core';
import { describe, expect, it } from 'vitest';
import { CATALOG, catalogFor, findDefinition } from './index.js';

function lookup(tree: unknown, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], tree);
}

describe('component catalog', () => {
  it('contains only valid, uniquely identified manifests', () => {
    for (const def of CATALOG) expect(validateManifest(def.manifest), def.manifest.id).toEqual([]);
    expect(new Set(CATALOG.map((d) => d.manifest.id)).size).toBe(CATALOG.length);
  });

  it('every component has a name in English and Persian', () => {
    for (const def of CATALOG) {
      for (const locale of ['en', 'fa'] as const) {
        expect(
          typeof lookup(resources[locale].components, def.manifest.nameKey),
          `${locale}: ${def.manifest.nameKey}`,
        ).toBe('string');
      }
    }
  });

  it('resolves definitions by id and creates independent model instances', () => {
    const led = findDefinition('actuator.led');
    expect(led.create()).not.toBe(led.create());
    expect(() => findDefinition('actuator.flux-capacitor')).toThrow(/Unknown component/);
  });

  it('offers the P1 basic set', () => {
    expect(catalogFor('P1').map((d) => d.manifest.id)).toEqual(
      expect.arrayContaining([
        'power.battery-9v',
        'driver.l298n',
        'actuator.tt-motor',
        'actuator.sg90-servo',
        'actuator.led',
      ]),
    );
  });
});
