/*
 * Step illustrations as inline SVG (no asset storage yet). Each has its own light card background so it
 * reads the same in light and dark themes, and no text, so one image serves both languages.
 */

const svg = (w: number, h: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
  `<rect width="${w}" height="${h}" rx="12" fill="#f5f2ea"/>${body}</svg>`;

/** Top view of the robot base, front to the right: chassis, wheels, caster, Uno, pack and switch. */
const robotTop = (x: number, y: number, extra = ''): string =>
  `<g transform="translate(${x} ${y})">` +
  `<rect x="0" y="10" width="150" height="100" rx="14" fill="#d9c9a3" stroke="#8a7650" stroke-width="2"/>` +
  `<rect x="34" y="-4" width="44" height="16" rx="4" fill="#333"/>` +
  `<rect x="34" y="108" width="44" height="16" rx="4" fill="#333"/>` +
  `<circle cx="135" cy="60" r="7" fill="#777"/>` +
  `<rect x="58" y="32" width="64" height="48" rx="4" fill="#1f6fa8"/>` +
  `<rect x="62" y="36" width="10" height="8" fill="#cfd8dc"/>` +
  `<rect x="10" y="30" width="38" height="56" rx="3" fill="#444"/>` +
  `<rect x="14" y="34" width="30" height="10" fill="#c0392b"/>` +
  `<rect x="14" y="72" width="30" height="10" fill="#222"/>` +
  `<rect x="20" y="92" width="16" height="10" rx="2" fill="#e0a800"/>` +
  extra +
  `</g>`;

export const BASE_SVG = svg(240, 150, robotTop(45, 13));

/** The Uno's digital header with the PWM (~) pins lit. */
export const PWM_SVG = svg(
  320,
  120,
  `<rect x="20" y="30" width="280" height="70" rx="6" fill="#1f6fa8"/>` +
    Array.from({ length: 14 }, (_, i) => {
      const pin = 13 - i;
      const pwm = [3, 5, 6, 9, 10, 11].includes(pin);
      const x = 36 + i * 18.5;
      return (
        `<rect x="${x}" y="38" width="12" height="12" rx="2" fill="${pwm ? '#f1c40f' : '#263238'}"/>` +
        (pwm ? `<path d="M${x} 62 q3 -6 6 0 t6 0" stroke="#f1c40f" stroke-width="2" fill="none"/>` : '')
      );
    }).join('') +
    `<path d="M36 84 h18 v-8 h10 v8 h10 v-8 h10 v8 h10 v-8 h10 v8 h18" stroke="#f1c40f" stroke-width="3" fill="none"/>`,
);

/** The line sensor's three eyes over a black line. */
export const LINE_SENSOR_SVG = svg(
  260,
  150,
  `<rect x="0" y="60" width="260" height="30" fill="#222"/>` +
    robotTop(20, 15, `<rect x="150" y="40" width="14" height="40" rx="3" fill="#2e7d32"/>`) +
    [52, 60, 68]
      .map((cy, i) => `<circle cx="177" cy="${cy + 15}" r="3.5" fill="${i === 1 ? '#ff5252' : '#ffcdd2'}"/>`)
      .join(''),
);

/** The sonar on the front sending a ping that bounces off a block. */
export const SONAR_SVG = svg(
  280,
  150,
  robotTop(15, 15, `<rect x="146" y="44" width="16" height="32" rx="4" fill="#1565c0"/>`) +
    `<circle cx="181" cy="65" r="5" fill="#cfd8dc"/><circle cx="181" cy="85" r="5" fill="#cfd8dc"/>` +
    [16, 30, 44]
      .map(
        (r) =>
          `<path d="M${190 + r} ${75 - r} a${r} ${r} 0 0 1 0 ${2 * r}" stroke="#1565c0" stroke-width="2.5" fill="none"/>`,
      )
      .join('') +
    `<rect x="248" y="30" width="20" height="90" rx="3" fill="#a1887f" stroke="#6d4c41" stroke-width="2"/>`,
);

export const LINE_FOLLOWER_COVER = svg(
  320,
  180,
  `<ellipse cx="160" cy="90" rx="130" ry="65" fill="none" stroke="#222" stroke-width="14"/>` +
    `<g transform="translate(118 2) scale(0.5)">${robotTop(0, 0, `<rect x="150" y="40" width="14" height="40" rx="3" fill="#2e7d32"/>`)}</g>`,
);

export const OBSTACLE_AVOIDER_COVER = svg(
  320,
  180,
  `<rect x="150" y="30" width="26" height="80" rx="3" fill="#a1887f"/>` +
    `<circle cx="240" cy="130" r="18" fill="#a1887f"/>` +
    `<circle cx="290" cy="60" r="16" fill="none" stroke="#2e7d32" stroke-width="4" stroke-dasharray="6 4"/>` +
    `<g transform="translate(30 80) scale(0.55)">${robotTop(0, 0, `<rect x="146" y="44" width="16" height="32" rx="4" fill="#1565c0"/>`)}</g>` +
    [14, 26]
      .map(
        (r) =>
          `<path d="M${125 + r} ${117 - r} a${r} ${r} 0 0 1 0 ${2 * r}" stroke="#1565c0" stroke-width="2.5" fill="none"/>`,
      )
      .join(''),
);
