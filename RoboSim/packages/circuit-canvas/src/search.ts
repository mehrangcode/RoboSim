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

/** E12 preferred values, 10 Ω – 1 MΩ: the resistor picker (FR-CIR-05). */
export const E12_OHMS: readonly number[] = [1, 10, 100, 1000, 10_000, 100_000]
  .flatMap((decade) =>
    [1, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2].map((m) => Math.round(m * decade * 10) / 10),
  )
  .filter((v) => v >= 10 && v <= 1_000_000)
  .concat([1_000_000]);
