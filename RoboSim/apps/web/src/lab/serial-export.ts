import type { DiffLine, SerialLine } from '@robosim/sim-runtime/client';
import { toCsv } from '../lib/csv.js';
import { formatSliceTime } from './format.js';

/** Serial log export and import (FR-SIM-21, Technical Design §18.5). */

export type SerialExportFormat = 'txt' | 'txt-times' | 'csv';

export const CSV_HEADER = ['time_ms', 'slice', 'baud', 'text'] as const;
/** Last line of an export whose capture passed the 1 MB cap (language-neutral: files are data). */
export const TRUNCATED_MARK = '--- truncated: output past 1 MB was not kept ---';

/**
 * Control characters as `\xNN` (tab kept); a backslash that would read as an escape is escaped too,
 * so {@link unescapeLine} restores the text exactly.
 */
export function escapeLine(text: string): string {
  return text.replace(
    // eslint-disable-next-line no-control-regex -- control characters are what this escapes.
    /[\x00-\x08\x0b-\x1f\x7f]|\\(?=x[0-9A-Fa-f]{2})/g,
    (c) => `\\x${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`,
  );
}

export function unescapeLine(text: string): string {
  return text.replace(/\\x([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

/** The file's text: plain, with `[mm:ss.mmm] ` simulated times, or `time_ms,slice,baud,text` CSV. */
export function serialExport(
  lines: readonly SerialLine[],
  format: SerialExportFormat,
  truncated: boolean,
): string {
  if (format === 'csv') {
    const rows = lines.map((l) => [l.slice, l.slice, l.baud, escapeLine(l.text)] as const);
    return toCsv([CSV_HEADER, ...rows, ...(truncated ? [[null, null, null, TRUNCATED_MARK] as const] : [])]);
  }
  const body = lines.map((l) =>
    format === 'txt-times' ? `[${formatSliceTime(l.slice)}] ${escapeLine(l.text)}` : escapeLine(l.text),
  );
  if (truncated) body.push(TRUNCATED_MARK);
  return body.length ? `${body.join('\n')}\n` : '';
}

/** `<project>-serial-<ISO date and time>.<ext>`, Latin digits whatever the locale. */
export function exportFileName(base: string, format: SerialExportFormat, now: Date): string {
  const stamp = now.toISOString().slice(0, 19).replace(/:/g, '-');
  return `${base}-serial-${stamp}.${format === 'csv' ? 'csv' : 'txt'}`;
}

export interface ImportedLog {
  readonly lines: DiffLine[];
  readonly timed: boolean;
  readonly truncated: boolean;
}

/** RFC 4180 records (quoted fields may hold commas, quotes and line breaks). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) rows.push([...row, field]);
  return rows;
}

const TIME_PREFIX = /^\[(?:(\d+):)?(\d{2}):(\d{2})\.(\d{3})\] /;

/**
 * Reads an exported log back: CSV with the export's header is timed; text whose every line has a
 * `[mm:ss.mmm] ` prefix is timed from it; any other text is untimed.
 */
export function parseSerialImport(file: string): ImportedLog {
  const text = file.replace(/^\uFEFF/, '');
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  if (firstLine === CSV_HEADER.join(',')) {
    const rows = parseCsv(text).slice(1);
    const truncated = rows.at(-1)?.[3] === TRUNCATED_MARK;
    const lines = (truncated ? rows.slice(0, -1) : rows)
      .filter((r) => r.length >= 4)
      .map((r) => ({ slice: Number(r[0]), text: unescapeLine(r[3] ?? '') }));
    return { lines, timed: true, truncated };
  }
  const raw = text.split(/\r\n|\r|\n/);
  if (raw.at(-1) === '') raw.pop();
  const truncated = raw.at(-1) === TRUNCATED_MARK;
  if (truncated) raw.pop();
  const timed = raw.length > 0 && raw.every((l) => TIME_PREFIX.test(l));
  const lines = raw.map((l): DiffLine => {
    if (!timed) return { text: unescapeLine(l) };
    const m = TIME_PREFIX.exec(l) as RegExpExecArray;
    const slice = Number(m[1] ?? 0) * 3_600_000 + Number(m[2]) * 60_000 + Number(m[3]) * 1000 + Number(m[4]);
    return { slice, text: unescapeLine(l.slice(m[0].length)) };
  });
  return { lines, timed, truncated };
}
