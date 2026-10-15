import { resources } from '@robosim/i18n';
import { validateManifest } from '@robosim/sim-core';
import { describe, expect, it } from 'vitest';
import { CATALOG, catalogFor, findDefinition } from './index.js';
import { CATALOG_MANIFESTS, findManifest, internalConnectionsOf } from './manifests.js';

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

  it('the engine-free manifest entry lists the same parts, in order, with the same strips', () => {
    expect(CATALOG_MANIFESTS).toEqual(CATALOG.map((d) => d.manifest));
    for (const def of CATALOG) {
      expect(findManifest(def.manifest.id)).toEqual(def.manifest);
      expect(internalConnectionsOf(def.manifest.id)).toEqual(def.internalConnections?.() ?? []);
    }
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

  it('offers exactly the basic-tier P1 components of PRD §7.2', () => {
    // Jumper wires are netlist edges, not models; the BOM counts them from project wires.
    const prdP1Basic = [
      'power.battery-9v',
      'power.battery-4aa',
      'power.switch',
      'actuator.tt-motor',
      'actuator.sg90-servo',
      'actuator.led',
      'actuator.buzzer-active',
      'driver.l298n',
      'sensor.hc-sr04',
      'sensor.tcrt5000',
      'sensor.line-3ch',
      'sensor.push-button',
      'sensor.ldr',
      'passive.resistor',
      'passive.potentiometer',
      'passive.breadboard-half',
      'passive.breadboard-full',
      'mechanical.chassis-2wd',
    ];
    expect(
      catalogFor('P1')
        .map((d) => d.manifest.id)
        .sort(),
    ).toEqual([...prdP1Basic].sort());
  });
});
