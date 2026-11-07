import { PART_FUNCTIONS, type PartFunction } from '@robosim/catalog/functions';
import type { ComponentManifest } from '@robosim/catalog/manifests';

type PartInterface = NonNullable<ComponentManifest['interfaces']>[number];

/**
 * Search normalisation (FR-CIR-10): Arabic ي/ك → Persian ی/ک, ZWNJ and diacritics removed, Persian
 * and Arabic-Indic digits → ASCII, case folded. Both the query and the names go through it.
 */
export function normalizeSearch(text: string): string {
  return text
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\u200c|\u200d|[\u064b-\u065f\u0670]/g, '')
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every query word appears in one of the names (any language). */
export function matches(query: string, names: readonly string[]): boolean {
  const words = normalizeSearch(query).split(' ').filter(Boolean);
  if (words.length === 0) return true;
  const haystack = names.map(normalizeSearch).join(' ');
  return words.every((w) => haystack.includes(w));
}

/** One synonym of a function, normalised once: its words and a space-free form (ZWNJ vs space vs joined). */
interface IndexedSynonym {
  readonly functionId: string;
  readonly synonym: string;
  readonly compact: string;
  readonly words: readonly string[];
  /** Offset of each word in `compact`. */
  readonly wordStarts: readonly number[];
}

const indexCache = new WeakMap<readonly PartFunction[], ReadonlyMap<string, readonly IndexedSynonym[]>>();

/** Normalised synonyms per function id, built once per vocabulary (TD §18.6 performance budget). */
function functionIndex(vocabulary: readonly PartFunction[]): ReadonlyMap<string, readonly IndexedSynonym[]> {
  let index = indexCache.get(vocabulary);
  if (!index) {
    index = new Map(
      vocabulary.map((f) => [
        f.id,
        [...f.synonyms.en, ...f.synonyms.fa].map((synonym) => {
          const text = normalizeSearch(synonym);
          const words = text.split(' ');
          let at = 0;
          const wordStarts = words.map((w) => (at += w.length) - w.length);
          return { functionId: f.id, synonym, compact: words.join(''), words, wordStarts };
        }),
      ]),
    );
    indexCache.set(vocabulary, index);
  }
  return index;
}

/**
 * A query word hits a synonym when it starts one of its words ("temp" → "temperature", but "resis" does
 * not hit "photoresistor"), or when a synonym word of ≥ 4 letters starts it (plurals: "motors" ←
 * "motor", «موتورها» ← «موتور»). Persian compounds written joined, with a ZWNJ or with a space are
 * caught by `phraseHit` comparing space-free forms.
 */
function wordHits(word: string, s: IndexedSynonym): boolean {
  return s.words.some((w) => w.startsWith(word) || (w.length >= 4 && word.startsWith(w)));
}

/**
 * The whole query, spaces removed, inside the space-free synonym from the start of one of its words
 * («اندازه گیری» ≡ «اندازه‌گیری» ≡ «اندازهگیری»).
 */
function phraseHit(compactQuery: string, s: IndexedSynonym): boolean {
  return compactQuery.length >= 2 && s.wordStarts.some((at) => s.compact.startsWith(compactQuery, at));
}

export interface RankedPart {
  readonly manifest: ComponentManifest;
  /** 100 phrase hit on a function synonym, 80 name/id hit, 60 × matched/query words for a partial function hit; 0 when unranked (query < 2 characters). */
  readonly score: number;
  readonly via: {
    readonly kind: 'function' | 'name';
    readonly functionId?: string;
    readonly synonym?: string;
  };
}

/** Score at which a function hit counts as a phrase hit (every query word in one synonym). */
export const PHRASE_SCORE = 100;
export const NAME_SCORE = 80;
/** Below this the best result is a weak, partial match: the library offers "Ask AI" (TD §18.6). */
export const WEAK_SCORE = 60;

/**
 * Library search by name and by function (FR-CIR-12, TD §18.6). `names` gives a part's searchable
 * names (both languages + id). Results are sorted by score, then basic before pro, then catalogue
 * order; parts scoring 0 are left out. A query under 2 characters keeps the plain `matches()` filter
 * (catalogue order, score 0).
 */
export function rankParts(
  query: string,
  manifests: readonly ComponentManifest[],
  names: (m: ComponentManifest) => readonly string[],
  vocabulary: readonly PartFunction[] = PART_FUNCTIONS,
): RankedPart[] {
  const q = normalizeSearch(query);
  if (q.length < 2)
    return manifests
      .filter((m) => matches(q, names(m)))
      .map((manifest) => ({ manifest, score: 0, via: { kind: 'name' as const } }));
  const all = q.split(' ');
  // Single letters ("a", «و») match nearly every synonym; digits ("5") carry meaning and stay.
  const meaningful = all.filter((w) => w.length > 1 || /\d/.test(w));
  const words = meaningful.length ? meaningful : all;
  const compactQuery = words.join('');
  const index = functionIndex(vocabulary);
  const ranked: (RankedPart & { order: number })[] = [];
  manifests.forEach((manifest, order) => {
    let best: RankedPart = { manifest, score: 0, via: { kind: 'name' } };
    if (matches(q, names(manifest))) best = { manifest, score: NAME_SCORE, via: { kind: 'name' } };
    for (const fnId of manifest.functions ?? [])
      for (const s of index.get(fnId) ?? []) {
        const hit = phraseHit(compactQuery, s) ? words.length : words.filter((w) => wordHits(w, s)).length;
        const ratio = hit / words.length;
        const score = ratio === 1 ? PHRASE_SCORE : ratio >= 0.5 ? (WEAK_SCORE * hit) / words.length : 0;
        if (score > best.score)
          best = { manifest, score, via: { kind: 'function', functionId: fnId, synonym: s.synonym } };
      }
    if (best.score > 0) ranked.push({ ...best, order });
  });
  ranked.sort(
    (a, b) =>
      b.score - a.score ||
      Number(a.manifest.tier === 'pro') - Number(b.manifest.tier === 'pro') ||
      a.order - b.order,
  );
  return ranked.map(({ order: _order, ...r }) => r);
}

/** The manifest's interfaces, else derived from its pins: I²C bus, analog or output pins (TD §18.6). */
export function interfacesOf(m: ComponentManifest): readonly PartInterface[] {
  if (m.interfaces) return m.interfaces;
  const derived: PartInterface[] = [];
  if (m.i2c) derived.push('i2c');
  if (m.pins.some((p) => p.kind === 'analog')) derived.push('analog');
  if (m.pins.some((p) => p.kind === 'output')) derived.push('digital');
  return derived;
}

/** E12 preferred values, 10 Ω – 1 MΩ: the resistor picker (FR-CIR-05). */
export const E12_OHMS: readonly number[] = [1, 10, 100, 1000, 10_000, 100_000]
  .flatMap((decade) =>
    [1, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2].map((m) => Math.round(m * decade * 10) / 10),
  )
  .filter((v) => v >= 10 && v <= 1_000_000)
  .concat([1_000_000]);
