/** CSV shared by the parts list (FR-BOM-05) and the oscilloscope export (FR-SIM-14). */

export type Cell = string | number | null;

/** CSV for spreadsheets: a UTF-8 byte-order mark (so Excel reads Persian), quoted fields, CRLF lines. */
export function toCsv(rows: readonly (readonly Cell[])[]): string {
  const field = (v: Cell) => {
    const s = v === null ? '' : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return `\uFEFF${rows.map((r) => r.map(field).join(',')).join('\r\n')}\r\n`;
}
