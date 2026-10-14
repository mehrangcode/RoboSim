// FR-I18N-03 gate: locale parity, ICU validity, placeholder parity, missing and unused keys.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parse, TYPE, type MessageFormatElement } from '@formatjs/icu-messageformat-parser';

const pkgDir = resolve(import.meta.dirname, '..');
const repoRoot = resolve(pkgDir, '../..');
const localesDir = join(pkgDir, 'locales');
const LOCALES = ['en', 'fa'] as const;
const errors: string[] = [];

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.set(path, value);
    else for (const [k, v] of flatten(value, path)) out.set(k, v);
  }
  return out;
}

function argumentNames(elements: MessageFormatElement[], acc = new Set<string>()): Set<string> {
  for (const el of elements) {
    if (
      el.type === TYPE.argument ||
      el.type === TYPE.number ||
      el.type === TYPE.date ||
      el.type === TYPE.time
    )
      acc.add(el.value);
    if (el.type === TYPE.plural || el.type === TYPE.select) {
      acc.add(el.value);
      for (const option of Object.values(el.options)) argumentNames(option.value, acc);
    }
    if (el.type === TYPE.tag) argumentNames(el.children, acc);
  }
  return acc;
}

// 1. Load and flatten every namespace per locale.
const namespaces = readdirSync(join(localesDir, 'en'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.slice(0, -5));
const catalog = new Map<string, Map<string, string>>(); // locale → "ns:key" → message
for (const locale of LOCALES) {
  const merged = new Map<string, string>();
  for (const ns of namespaces) {
    const file = join(localesDir, locale, `${ns}.json`);
    let tree: Tree;
    try {
      tree = JSON.parse(readFileSync(file, 'utf8')) as Tree;
    } catch (e) {
      errors.push(`${relative(repoRoot, file)}: cannot read (${(e as Error).message})`);
      continue;
    }
    for (const [key, message] of flatten(tree)) merged.set(`${ns}:${key}`, message);
  }
  catalog.set(locale, merged);
}
const extra = readdirSync(join(localesDir, 'fa')).filter(
  (f) => f.endsWith('.json') && !namespaces.includes(f.slice(0, -5)),
);
for (const f of extra) errors.push(`locales/fa/${f}: namespace missing in en`);

// 2. Parity + ICU syntax + placeholder parity.
const en = catalog.get('en') ?? new Map<string, string>();
const fa = catalog.get('fa') ?? new Map<string, string>();
for (const key of en.keys()) if (!fa.has(key)) errors.push(`${key}: missing in fa`);
for (const key of fa.keys()) if (!en.has(key)) errors.push(`${key}: missing in en`);
for (const [key, enMessage] of en) {
  const faMessage = fa.get(key);
  try {
    const enArgs = argumentNames(parse(enMessage));
    if (faMessage === undefined) continue;
    const faArgs = argumentNames(parse(faMessage));
    const same = enArgs.size === faArgs.size && [...enArgs].every((a) => faArgs.has(a));
    if (!same)
      errors.push(
        `${key}: placeholders differ (en: ${[...enArgs].join(',')} / fa: ${[...faArgs].join(',')})`,
      );
  } catch (e) {
    errors.push(`${key}: invalid ICU message (${(e as Error).message})`);
  }
}

// 3. Scan sources for used keys.
const SOURCE_ROOTS = ['apps', 'packages'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.turbo', 'locales', 'test']);
const KEY_CALL = /\bt\(\s*['"]([^'"]+)['"]/g;
const TRANS_KEY = /i18nKey=["']([^"']+)["']/g;

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* sourceFiles(full);
    else if (
      /\.(ts|tsx)$/.test(entry) &&
      !/\.(test|spec)\.tsx?$/.test(entry) &&
      !full.includes(join('i18n', 'scripts'))
    )
      yield full;
  }
}

const used = new Set<string>();
for (const root of SOURCE_ROOTS) {
  for (const file of sourceFiles(join(repoRoot, root))) {
    const text = readFileSync(file, 'utf8');
    for (const re of [KEY_CALL, TRANS_KEY]) {
      for (const match of text.matchAll(re)) {
        const key = match[1] ?? '';
        if (!key.includes(':')) {
          errors.push(`${relative(repoRoot, file)}: key "${key}" must be namespace-qualified ("ns:key")`);
        } else {
          used.add(key);
          if (!en.has(key)) errors.push(`${relative(repoRoot, file)}: unknown key "${key}"`);
        }
      }
    }
  }
}

const { prefixes } = JSON.parse(readFileSync(join(pkgDir, 'dynamic-keys.json'), 'utf8')) as {
  prefixes: string[];
};
for (const key of en.keys()) {
  if (!used.has(key) && !prefixes.some((p) => key.startsWith(p)))
    errors.push(`${key}: unused (remove it or list its prefix in dynamic-keys.json)`);
}

if (errors.length) {
  console.error(`i18n check failed with ${errors.length} problem(s):\n  - ${errors.join('\n  - ')}`);
  process.exit(1);
}
console.warn(
  `i18n check passed: ${en.size} keys × ${LOCALES.length} locales, ${used.size} referenced statically.`,
);
