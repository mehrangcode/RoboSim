import type { SerialLine } from '@robosim/sim-runtime/client';
import { describe, expect, it } from 'vitest';
import {
  TRUNCATED_MARK,
  escapeLine,
  exportFileName,
  parseSerialImport,
  serialExport,
  unescapeLine,
} from './serial-export.js';

const lines: SerialLine[] = [
  { slice: 0, text: 'RoboSim ready', baud: 115200 },
  { slice: 1000, text: 'a, "quoted", b', baud: 115200 },
  { slice: 61_234, text: 'bell\x07 tab\tend', baud: 9600 },
  { slice: 3_723_004, text: 'path C:\\x41\\dir', baud: 9600 },
];

describe('serial export (FR-SIM-21 AC1)', () => {
  it('writes plain text and text with simulated times', () => {
    expect(serialExport(lines.slice(0, 1), 'txt', false)).toBe('RoboSim ready\n');
    expect(serialExport(lines, 'txt-times', false).split('\n')).toEqual([
      '[00:00.000] RoboSim ready',
      '[00:01.000] a, "quoted", b',
      '[01:01.234] bell\\x07 tab\tend',
      '[1:02:03.004] path C:\\x5Cx41\\dir',
      '',
    ]);
    expect(serialExport([], 'txt', false)).toBe('');
  });

  it('writes RFC 4180 CSV with time_ms = slice', () => {
    const csv = serialExport(lines.slice(0, 3), 'csv', false);
    expect(csv).toBe(
      '\uFEFFtime_ms,slice,baud,text\r\n0,0,115200,RoboSim ready\r\n1000,1000,115200,"a, ""quoted"", b"\r\n' +
        '61234,61234,9600,bell\\x07 tab\tend\r\n',
    );
  });

  it('escapes control characters as \\xNN and round-trips them', () => {
    expect(escapeLine('a\x00b\x1b[0m\x7f')).toBe('a\\x00b\\x1B[0m\\x7F');
    for (const s of ['plain', 'C:\\x41', '\\\\x', 'a\x01\\x02']) expect(unescapeLine(escapeLine(s))).toBe(s);
  });

  it('marks a truncated capture in both formats', () => {
    expect(serialExport(lines.slice(0, 1), 'txt', true)).toBe(`RoboSim ready\n${TRUNCATED_MARK}\n`);
    expect(serialExport(lines.slice(0, 1), 'csv', true).trimEnd().split('\r\n').at(-1)).toBe(
      `,,,${TRUNCATED_MARK}`,
    );
  });

  it('names the file with Latin digits', () => {
    expect(exportFileName('ربات', 'csv', new Date('2026-11-04T12:34:56.789Z'))).toBe(
      'ربات-serial-2026-11-04T12-34-56.csv',
    );
    expect(exportFileName('p', 'txt-times', new Date(0))).toMatch(/\.txt$/);
  });
});

describe('serial import', () => {
  const back = (format: 'txt' | 'txt-times' | 'csv', truncated = false) =>
    parseSerialImport(serialExport(lines, format, truncated));

  it('round-trips the exported CSV with times', () => {
    expect(back('csv')).toEqual({
      lines: lines.map(({ slice, text }) => ({ slice, text })),
      timed: true,
      truncated: false,
    });
    expect(back('csv', true).truncated).toBe(true);
  });

  it('reads timed text back from the time prefix and plain text as untimed', () => {
    expect(back('txt-times').lines).toEqual(lines.map(({ slice, text }) => ({ slice, text })));
    expect(back('txt-times').timed).toBe(true);
    expect(back('txt', true)).toEqual({
      lines: lines.map(({ text }) => ({ text })),
      timed: false,
      truncated: true,
    });
    expect(parseSerialImport('one\r\ntwo\rthree')).toMatchObject({
      lines: [{ text: 'one' }, { text: 'two' }, { text: 'three' }],
    });
  });
});
