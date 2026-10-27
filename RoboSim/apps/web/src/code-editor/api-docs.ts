import { ARDUINO_CLASSES, ARDUINO_LIBRARIES, docKey, type ArduinoApiEntry } from '@robosim/shared';
import type { TFunction } from 'i18next';

/** Escapes text for Monaco's markdown renderer. */
const md = (s: string) => s.replace(/[\\`*_{}[\]<>()#+!|]/g, '\\$&');

const fence = (code: string) => `\`\`\`cpp\n${code}\n\`\`\``;

/** The library an entry comes from, or undefined for the Arduino core. */
function libraryOf(e: ArduinoApiEntry) {
  const cls = e.kind === 'type' ? e.name : e.of;
  const name = ARDUINO_CLASSES.find((c) => c.name === cls)?.library ?? null;
  return name === null ? undefined : ARDUINO_LIBRARIES.find((l) => l.name === name);
}

/**
 * Hover / completion docs for an API entry in the UI language (FR-COD-02): signature, summary,
 * parameters, return value, example and — for library members — the `#include` it needs.
 * Returns undefined when the entry has no doc (yet).
 */
export function apiDocMarkdown(e: ArduinoApiEntry, t: TFunction): string | undefined {
  const key = `apidocs:${docKey(e)}`;
  const summary = t(`${key}.summary`, { defaultValue: '' });
  if (!summary) return undefined;
  const parts = [fence(e.detail), md(summary)];
  const params = (e.params ?? []).map(
    (p) => `- \`${p}\` — ${md(t(`${key}.params.${p}`, { defaultValue: '' }))}`,
  );
  if (params.length > 0) parts.push(`**${md(t('shell:code.docs.params'))}**\n\n${params.join('\n')}`);
  if (e.returns) parts.push(`**${md(t('shell:code.docs.returns'))}** ${md(t(`${key}.returns`))}`);
  if (e.example) parts.push(`**${md(t('shell:code.docs.example'))}**\n\n${fence(e.example)}`);
  const lib = libraryOf(e);
  if (lib)
    parts.push(
      `*${md(t('shell:code.docs.library', { name: lib.name, version: lib.version }))}* — ${lib.includes
        .map((h) => `\`#include <${h}>\``)
        .join(' ')}`,
    );
  return parts.join('\n\n');
}
