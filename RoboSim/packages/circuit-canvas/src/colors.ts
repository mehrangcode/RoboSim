const GOLD = '#d4a017';
const BAND = [
  '#111',
  '#7c4a1e',
  '#d62828',
  '#f77f00',
  '#fcbf49',
  '#2a9d8f',
  '#1d4ed8',
  '#7b2cbf',
  '#6b7280',
  '#f8fafc',
];

/** 4-band colour code of a resistance (two digits × multiplier; gold multiplier below 10 Ω). */
export function resistorBands(ohms: number): readonly string[] {
  const band = (i: number) => BAND[Math.min(Math.max(i, 0), 9)] ?? '#111';
  if (!(ohms > 0)) return [band(0), band(0), band(0)];
  let exp = Math.floor(Math.log10(ohms)) - 1;
  let digits = Math.round(ohms / 10 ** exp);
  if (digits >= 100) {
    digits = Math.round(digits / 10);
    exp += 1;
  }
  return [band(Math.floor(digits / 10)), band(digits % 10), exp < 0 ? GOLD : band(exp)];
}

export { GOLD };
