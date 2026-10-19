// Value markings printed on parts (drawn by the part art).

/** EIA capacitance code printed on ceramic capacitors: two digits and a power of ten in pF (104 = 100 nF). */
export function capacitorCode(nf: number): string {
  const pf = nf * 1000;
  if (pf < 10) return `${Math.round(pf * 10) / 10}`;
  const exp = Math.floor(Math.log10(pf)) - 1;
  const digits = Math.round(pf / 10 ** exp);
  return digits >= 100 ? `${digits / 10}${exp + 1}` : `${digits}${exp}`;
}
