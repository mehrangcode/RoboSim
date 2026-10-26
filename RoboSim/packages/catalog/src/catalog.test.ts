import { resources } from '@robosim/i18n';
import { validateManifest } from '@robosim/sim-core';
import { describe, expect, it } from 'vitest';
import { CATALOG, catalogFor, findDefinition } from './index.js';
import { CATALOG_MANIFESTS, findManifest, internalConnectionsOf, variantPropsOf } from './manifests.js';

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
      expect(internalConnectionsOf(def.manifest.id)).toEqual(
        def.internalConnections?.() ?? def.manifest.bondedPins ?? [],
      );
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

  it('every property, option and user input has an editor label in both languages', () => {
    for (const def of CATALOG) {
      const m = def.manifest;
      const keys = [
        ...Object.keys(m.props).map((k) => `prop.${k}`),
        ...Object.values(m.props).flatMap((spec) =>
          spec.type === 'enum' ? spec.options.map((o) => `option.${o}`) : [],
        ),
        ...m.inputs.map((i) => `input.${i.name}`),
      ];
      for (const locale of ['en', 'fa'] as const)
        for (const key of keys)
          expect(typeof lookup(resources[locale].editor, key), `${locale}: ${m.id} editor:${key}`).toBe(
            'string',
          );
    }
  });

  it('resolves definitions by id and creates independent model instances', () => {
    const led = findDefinition('actuator.led');
    expect(led.create()).not.toBe(led.create());
    expect(() => findDefinition('actuator.flux-capacitor')).toThrow(/Unknown component/);
  });

  it('offers exactly the P1 components of PRD §7.2, by tier', () => {
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
      // Catalogue expansion Tier A (slices 16a–c).
      'semiconductor.diode-1n4007',
      'semiconductor.diode-1n4148',
      'semiconductor.zener-5v1',
      'semiconductor.lm7805',
      'semiconductor.ams1117-3v3',
      'actuator.led-rgb',
      'actuator.buzzer-passive',
      'display.seven-segment',
      'ic.74hc00',
      'ic.74hc08',
      'ic.74hc32',
      'ic.74hc86',
      'ic.74hc14',
      'ic.74hc595',
      'ic.cd4017',
      'ic.uln2003a',
      'sensor.bump-switch',
      'sensor.joystick',
      'sensor.rotary-encoder',
      'sensor.sound',
      'sensor.soil-moisture',
    ];
    const prdP1Pro = [
      'power.lm2596',
      'actuator.mg996r-servo',
      'actuator.relay-module',
      'actuator.stepper-28byj48',
      'driver.tb6612fng',
      'driver.l9110s',
      'sensor.line-5ch',
      'sensor.ir-obstacle',
      'sensor.pir',
      'sensor.keypad-4x4',
    ];
    const ids = (tier: string) =>
      catalogFor('P1')
        .filter((d) => d.manifest.tier === tier)
        .map((d) => d.manifest.id)
        .sort();
    expect(ids('basic')).toEqual([...prdP1Basic].sort());
    expect(ids('pro')).toEqual([...prdP1Pro].sort());
  });

  it('keys BOM variants only by props the part has', () => {
    for (const m of CATALOG_MANIFESTS)
      for (const prop of variantPropsOf(m.id)) expect(m.props[prop], `${m.id}.${prop}`).toBeDefined();
    expect(variantPropsOf('passive.resistor')).toEqual(['ohms']);
    expect(variantPropsOf('driver.l298n')).toEqual([]);
  });
});
