import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { mergeOwned } from './use-bom-data.js';
import { toCsv, toXlsx } from './exports.js';

describe('parts list exports (FR-BOM-05)', () => {
  it('writes CSV Excel reads as UTF-8, quoting where needed', () => {
    const csv = toCsv([
      ['قطعه', 'Qty'],
      ['Resistor, 220 Ω', 2],
      ['Say "hi"', null],
    ]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv.slice(1)).toBe('قطعه,Qty\r\n"Resistor, 220 Ω",2\r\n"Say ""hi""",\r\n');
  });

  it('writes a one-sheet XLSX with numbers, escaped text and an RTL view', () => {
    const files = unzipSync(
      toXlsx(
        'فهرست قطعات',
        [
          ['Part', 'Qty'],
          ['A & <B>', 3],
        ],
        true,
      ),
    );
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining([
        '[Content_Types].xml',
        'xl/workbook.xml',
        'xl/worksheets/sheet1.xml',
        'xl/styles.xml',
      ]),
    );
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml'] ?? new Uint8Array());
    expect(sheet).toContain('rightToLeft="1"');
    expect(sheet).toContain(
      '<c r="A2" t="inlineStr"><is><t xml:space="preserve">A &amp; &lt;B&gt;</t></is></c>',
    );
    expect(sheet).toContain('<c r="B2"><v>3</v></c>');
    expect(sheet).toContain('<c r="A1" s="1" t="inlineStr">');
    expect(strFromU8(files['xl/workbook.xml'] ?? new Uint8Array())).toContain('name="فهرست قطعات"');
  });
});

describe('owned parts (FR-BOM-03)', () => {
  it('merges a guest’s marks into the account, keeping the larger count', () => {
    expect(mergeOwned({ a: 1, b: 3 }, { b: 2, c: 4 })).toEqual({ a: 1, b: 3, c: 4 });
  });
});
