import { CATALOG_MANIFESTS, type ComponentManifest } from '@robosim/catalog/manifests';
import { resources } from '@robosim/i18n';
import { describe, expect, it } from 'vitest';
import { matches, NAME_SCORE, PHRASE_SCORE, rankParts } from './search.js';

function nameIn(locale: 'en' | 'fa', m: ComponentManifest): string {
  return m.nameKey
    .split('.')
    .reduce<unknown>((n, k) => (n as Record<string, unknown>)[k], resources[locale].components) as string;
}
const names = (m: ComponentManifest) => [nameIn('fa', m), nameIn('en', m), m.id];
const top = (q: string, n = 3) =>
  rankParts(q, CATALOG_MANIFESTS, names)
    .slice(0, n)
    .map((r) => r.manifest.id);

describe('rankParts (FR-CIR-12, TD §18.6)', () => {
  it('"measure distance" puts HC-SR04 first, then VL53L0X, with a function reason', () => {
    const [first, second] = rankParts('measure distance', CATALOG_MANIFESTS, names);
    expect(first?.manifest.id).toBe('sensor.hc-sr04');
    expect(first?.score).toBe(PHRASE_SCORE);
    expect(first?.via).toMatchObject({ kind: 'function', functionId: 'measure-distance' });
    expect(second?.manifest.id).toBe('sensor.vl53l0x');
  });

  it('Persian forms (ZWNJ, space, joined, Arabic ي/ك) give the same ranking as English', () => {
    const en = top('measure distance', 2);
    for (const q of ['اندازه‌گیری فاصله', 'اندازه گیری فاصله', 'اندازهگیری فاصله', 'اندازه گيري فاصله'])
      expect(top(q, 2), q).toEqual(en);
    expect(top('سنسور مانع كوچك'), 'Arabic ك').toEqual(top('سنسور مانع کوچک'));
  });

  it('"drive two motors" ranks the dual drivers above single-motor parts', () => {
    const ranked = rankParts('drive two motors', CATALOG_MANIFESTS, names);
    const ids = ranked.map((r) => r.manifest.id);
    expect(ids.slice(0, 3)).toEqual(
      expect.arrayContaining(['driver.l298n', 'driver.tb6612fng', 'driver.l9110s']),
    );
    expect(ids[0]).toBe('driver.l298n'); // basic before pro
    expect(ids.indexOf('driver.irf520-module')).toBeGreaterThan(2);
    expect(top('راه اندازی دو موتور')).toEqual(ids.slice(0, 3));
  });

  it('"۵ ولت" and "5v" find the 5 V regulators', () => {
    for (const q of ['۵ ولت', '5 ولت', '5v'])
      expect(top(q), q).toEqual(expect.arrayContaining(['semiconductor.lm7805', 'power.lm2596']));
  });

  it('plurals and other functions', () => {
    expect(top('motor drivers')).toContain('driver.l298n');
    expect(top('دماسنج')).toContain('sensor.ds18b20');
    expect(top('follow line')).toEqual(
      expect.arrayContaining(['sensor.line-3ch', 'sensor.tcrt5000', 'sensor.line-5ch']),
    );
  });

  it('a name query still finds the part by name', () => {
    const [first] = rankParts('l298', CATALOG_MANIFESTS, names);
    expect(first?.manifest.id).toBe('driver.l298n');
    expect(first?.score).toBe(NAME_SCORE);
    expect(first?.via.kind).toBe('name');
    expect(top('HC-SR04', 1)).toEqual(['sensor.hc-sr04']);
  });

  it('a query under 2 characters keeps the plain name filter, unranked', () => {
    const r = rankParts('l', CATALOG_MANIFESTS, names);
    expect(r.map((x) => x.manifest.id)).toEqual(
      CATALOG_MANIFESTS.filter((m) => matches('l', names(m))).map((m) => m.id),
    );
    expect(rankParts('', CATALOG_MANIFESTS, names)).toHaveLength(CATALOG_MANIFESTS.length);
  });

  it('nonsense finds nothing', () => {
    expect(rankParts('qwxz plorp', CATALOG_MANIFESTS, names)).toEqual([]);
  });

  it('ranks the catalogue in < 2 ms per keystroke', () => {
    const queries = ['measure distance', 'اندازه گیری فاصله', 'drive two motors', '۵ ولت', 'temp'];
    rankParts('warm up', CATALOG_MANIFESTS, names);
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) for (const q of queries) rankParts(q, CATALOG_MANIFESTS, names);
    expect((performance.now() - t0) / (20 * queries.length)).toBeLessThan(2);
  });
});
