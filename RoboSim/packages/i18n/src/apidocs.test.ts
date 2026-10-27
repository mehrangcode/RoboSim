import { ARDUINO_API, ARDUINO_CLASSES, ARDUINO_LIBRARIES, docKey } from '@robosim/shared';
import { describe, expect, it } from 'vitest';
import enDocs from '../locales/en/apidocs.json' with { type: 'json' };

type Doc = { summary?: unknown; params?: Record<string, unknown>; returns?: unknown };
type Tree = Record<string, Record<string, Doc | string>>;

const get = (tree: Tree, key: string) => {
  const [top = '', ...rest] = key.split('.');
  return tree[top]?.[rest.join('.')];
};

// fa has the same keys as en: the i18n gate (scripts/check.ts) enforces locale parity.
describe('API docs (FR-COD-02)', () => {
  const en = enDocs as unknown as Tree;

  it('documents every entry, parameter and return value in the apidocs namespace', () => {
    const problems: string[] = [];
    for (const e of ARDUINO_API) {
      const key = docKey(e);
      const doc = get(en, key);
      if (typeof doc !== 'object' || typeof doc.summary !== 'string') {
        problems.push(`${key}: no summary`);
        continue;
      }
      for (const p of e.params ?? [])
        if (typeof doc.params?.[p] !== 'string') problems.push(`${key}: param "${p}" undocumented`);
      for (const p of Object.keys(doc.params ?? {}))
        if (!(e.params ?? []).includes(p)) problems.push(`${key}: param "${p}" not in signature`);
      if (Boolean(e.returns) !== (typeof doc.returns === 'string'))
        problems.push(`${key}: returns ${e.returns ? 'undocumented' : 'documented but void'}`);
    }
    expect(problems).toEqual([]);
  });

  it('has no docs for entries that do not exist', () => {
    const used = new Set(ARDUINO_API.map(docKey));
    const orphans = Object.entries(en)
      .filter(([top]) => top !== 'library')
      .flatMap(([top, v]) => Object.keys(v).map((k) => `${top}.${k}`))
      .filter((k) => !used.has(k));
    expect(orphans).toEqual([]);
  });

  it('describes every library and every class belongs to a listed library', () => {
    const libs = ARDUINO_LIBRARIES.map((l) => l.name);
    expect(libs.filter((n) => typeof en.library?.[n] !== 'string')).toEqual([]);
    for (const c of ARDUINO_CLASSES) if (c.library !== null) expect(libs).toContain(c.library);
  });
});
