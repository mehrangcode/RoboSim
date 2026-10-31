/*
 * Drawing pieces for the bench projects' covers and step images: inline SVG on a light card (reads the same
 * in light and dark themes), no text, so one image serves both languages. Same style as assets.ts.
 */

export const card = (w: number, h: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
  `<rect width="${w}" height="${h}" rx="12" fill="#f5f2ea"/>${body}</svg>`;

/** Uno seen from above, 110 × 84, USB to the left, headers along the top and bottom edges. */
export const uno = (x: number, y: number): string =>
  `<g transform="translate(${x} ${y})">` +
  `<rect width="110" height="84" rx="6" fill="#1f6fa8"/>` +
  `<rect x="-6" y="12" width="20" height="16" rx="2" fill="#cfd8dc"/>` +
  `<rect x="-4" y="58" width="16" height="14" rx="2" fill="#263238"/>` +
  `<rect x="40" y="30" width="42" height="14" rx="2" fill="#263238"/>` +
  `<rect x="34" y="4" width="70" height="7" rx="1" fill="#263238"/>` +
  `<rect x="44" y="73" width="60" height="7" rx="1" fill="#263238"/>` +
  `</g>`;

/** LED, body up, legs down to (x, y). */
export const led = (x: number, y: number, color: string, lit = true): string =>
  (lit ? `<circle cx="${x}" cy="${y - 22}" r="16" fill="${color}" opacity="0.25"/>` : '') +
  `<path d="M${x - 9} ${y - 12} v-12 a9 9 0 0 1 18 0 v12 z" fill="${color}" stroke="#555" stroke-width="1.5"/>` +
  `<rect x="${x - 11}" y="${y - 13}" width="22" height="3" fill="${color}" stroke="#555" stroke-width="1"/>` +
  `<path d="M${x - 4} ${y - 10} v10 M${x + 4} ${y - 10} v6" stroke="#888" stroke-width="2"/>`;

/** Horizontal resistor centred on (x, y) with leads, 60 wide. */
export const resistor = (x: number, y: number): string =>
  `<path d="M${x - 30} ${y} h60" stroke="#888" stroke-width="2"/>` +
  `<rect x="${x - 16}" y="${y - 6}" width="32" height="12" rx="5" fill="#e8c88f" stroke="#8a7650"/>` +
  [-9, -3, 3]
    .map(
      (dx, i) =>
        `<rect x="${x + dx}" y="${y - 6}" width="3" height="12" fill="${['#c0392b', '#c0392b', '#6d4c41'][i]}"/>`,
    )
    .join('');

/** A wire as a polyline. */
export const wire = (points: string, color: string): string =>
  `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`;

/** A pin dot. */
export const dot = (x: number, y: number, color = '#263238'): string =>
  `<circle cx="${x}" cy="${y}" r="4" fill="${color}"/>`;
