import type { PinRef, ProjectDocument } from '@robosim/shared';
import { partBox, pinNamesOf } from './document.js';
import { pinPosition, type Point } from './geometry.js';

/** Where the virtual multimeter's probes sit on the canvas (FR-SIM-13); all optional. */
export interface ProbeMarkers {
  readonly red?: PinRef | null;
  readonly black?: PinRef | null;
  /** A wire whose current is shown: the arrow points the way conventional current flows. */
  readonly wire?: { readonly id: string; readonly label: string; readonly reversed: boolean } | null;
  /** The part whose power is measured. */
  readonly part?: string | null;
}

const RED = '#dc2626';
const BLACK = '#111827';

/** A probe tip: a ringed disc with a glyph ("+" / "COM"), so red and black differ by more than colour. */
function Tip({ at, color, glyph, testId }: { at: Point; color: string; glyph: string; testId: string }) {
  const [x, y] = at;
  return (
    <g data-testid={testId} pointerEvents="none">
      <line x1={x} y1={y} x2={x + 3.2} y2={y - 5.2} stroke={color} strokeWidth={0.8} strokeLinecap="round" />
      <circle cx={x} cy={y} r={1.3} fill="#fff" stroke={color} strokeWidth={0.6} />
      <circle cx={x} cy={y} r={0.55} fill={color} />
      <rect x={x + 2.2} y={y - 8.4} width={glyph.length > 1 ? 7 : 3.6} height={3.4} rx={0.6} fill={color} />
      <text
        x={x + 2.2 + (glyph.length > 1 ? 3.5 : 1.8)}
        y={y - 5.9}
        textAnchor="middle"
        fontSize={2.6}
        fontFamily="ui-monospace, monospace"
        fontWeight={700}
        fill="#fff"
      >
        {glyph}
      </text>
    </g>
  );
}

/** Midpoint of the longest segment of a polyline, with the segment's direction. */
function midpoint(path: readonly Point[]): { at: Point; dir: Point } | null {
  let best: { at: Point; dir: Point; len: number } | null = null;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (!a || !b) continue;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len > 0 && (!best || len > best.len))
      best = {
        at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
        dir: [(b[0] - a[0]) / len, (b[1] - a[1]) / len],
        len,
      };
  }
  return best;
}

/**
 * Probe markers drawn above the circuit (inside the canvas transform): red "+" and black "COM" tips on
 * their pins, an arrow with the signed value on a measured wire, a dashed outline on a measured part.
 * Purely visual: pointer events pass through to the circuit.
 */
export function ProbeOverlay({ doc, markers }: { doc: ProjectDocument; markers: ProbeMarkers }) {
  const red = markers.red ? pinPosition(doc, markers.red, pinNamesOf) : null;
  const black = markers.black ? pinPosition(doc, markers.black, pinNamesOf) : null;
  const wire = markers.wire ? doc.wires.find((w) => w.id === markers.wire?.id) : undefined;
  const wirePath = wire
    ? [pinPosition(doc, wire.from, pinNamesOf), ...wire.points, pinPosition(doc, wire.to, pinNamesOf)]
    : [];
  const mid = wirePath.every((p): p is Point => p !== null) ? midpoint(wirePath) : null;
  const box = markers.part ? partBox(doc, markers.part) : null;
  return (
    <g data-testid="probe-overlay">
      {box && (
        <rect
          data-testid="probe-part"
          x={box.x - 1}
          y={box.y - 1}
          width={box.w + 2}
          height={box.h + 2}
          rx={1.5}
          fill="none"
          stroke="#7c3aed"
          strokeWidth={0.5}
          strokeDasharray="1.5 1"
          pointerEvents="none"
        />
      )}
      {mid && markers.wire && (
        <g data-testid="probe-wire" pointerEvents="none">
          {(() => {
            const sign = markers.wire.reversed ? -1 : 1;
            const [dx, dy] = [mid.dir[0] * sign, mid.dir[1] * sign];
            const [x, y] = mid.at;
            const tip: Point = [x + dx * 2.5, y + dy * 2.5];
            const back: Point = [x - dx * 2.5, y - dy * 2.5];
            const wing = (s: number): Point => [
              tip[0] - dx * 1.6 + -dy * s * 1.2,
              tip[1] - dy * 1.6 + dx * s * 1.2,
            ];
            const [l, r] = [wing(1), wing(-1)];
            return (
              <>
                <line x1={back[0]} y1={back[1]} x2={tip[0]} y2={tip[1]} stroke="#7c3aed" strokeWidth={0.7} />
                <path
                  d={`M${l[0]} ${l[1]}L${tip[0]} ${tip[1]}L${r[0]} ${r[1]}`}
                  fill="none"
                  stroke="#7c3aed"
                  strokeWidth={0.7}
                />
              </>
            );
          })()}
          <text
            x={mid.at[0] + mid.dir[1] * 3.5}
            y={mid.at[1] - mid.dir[0] * 3.5 + 1}
            textAnchor="middle"
            fontSize={2.8}
            fontFamily="ui-monospace, monospace"
            fill="#7c3aed"
            stroke="#fff"
            strokeWidth={0.6}
            paintOrder="stroke"
          >
            {markers.wire.label}
          </text>
        </g>
      )}
      {black && <Tip at={black} color={BLACK} glyph="COM" testId="probe-black" />}
      {red && <Tip at={red} color={RED} glyph="+" testId="probe-red" />}
    </g>
  );
}
