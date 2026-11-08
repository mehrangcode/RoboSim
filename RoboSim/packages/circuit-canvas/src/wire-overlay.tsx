import type { ProjectDocument, Wire } from '@robosim/shared';
import { pinNamesOf } from './document.js';
import { pinPosition, type Point } from './geometry.js';
import { WIRE_COLORS } from './wire-convention.js';

function polyline(doc: ProjectDocument, w: Wire): Point[] | null {
  const a = pinPosition(doc, w.from, pinNamesOf);
  const b = pinPosition(doc, w.to, pinNamesOf);
  return a && b ? [a, ...w.points, b] : null;
}

/** The badge letter: the universal "information" sign, the same in every language. */
const INFO_GLYPH = 'i';

/** The point halfway along a polyline. */
function midpoint(pts: readonly Point[]): Point {
  const segs = pts.slice(1).map((b, i) => {
    const a = pts[i] as Point;
    return { a, b, l: Math.hypot(b[0] - a[0], b[1] - a[1]) };
  });
  let left = segs.reduce((s, g) => s + g.l, 0) / 2;
  for (const { a, b, l } of segs) {
    if (left <= l && l > 0) return [a[0] + ((b[0] - a[0]) * left) / l, a[1] + ((b[1] - a[1]) * left) / l];
    left -= l;
  }
  return pts[0] ?? [0, 0];
}

/**
 * Wiring hints and the tidy preview on the canvas (FR-CIR-11): an "i" badge on each hinted wire (a shape,
 * not colour only), and the tidied routes of the changed wires as dashed lines in their new colour.
 */
export function WireOverlay({
  doc,
  hinted,
  hintLabel,
  preview,
  changed,
}: {
  doc: ProjectDocument;
  hinted: ReadonlySet<string>;
  hintLabel: string;
  preview: ProjectDocument | null;
  changed: readonly string[];
}) {
  const moved = new Set(changed);
  return (
    <g pointerEvents="none">
      {preview?.wires
        .filter((w) => moved.has(w.id))
        .map((w) => {
          const pts = polyline(preview, w);
          if (!pts) return null;
          return (
            <polyline
              key={w.id}
              data-tidy-preview={w.id}
              points={pts.map((p) => p.join(',')).join(' ')}
              fill="none"
              stroke={WIRE_COLORS[w.color] ?? w.color}
              strokeWidth={0.8}
              strokeDasharray="1.6 1"
              strokeLinejoin="round"
            />
          );
        })}
      {!preview &&
        doc.wires
          .filter((w) => hinted.has(w.id))
          .map((w) => {
            const pts = polyline(doc, w);
            if (!pts) return null;
            const [x, y] = midpoint(pts);
            return (
              <g key={w.id} data-hint-marker={w.id} transform={`translate(${x} ${y})`}>
                <title>{hintLabel}</title>
                <circle r={1.5} fill="#fff" stroke="#0284c7" strokeWidth={0.35} />
                <text
                  y={0.75}
                  textAnchor="middle"
                  fontSize={2.2}
                  fontWeight={700}
                  fontFamily="serif"
                  fill="#0284c7"
                >
                  {INFO_GLYPH}
                </text>
              </g>
            );
          })}
    </g>
  );
}
