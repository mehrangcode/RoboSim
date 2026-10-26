import { breadboardLayout } from '@robosim/catalog/manifests';
import { BOARD_PART, type ComponentInstance, type PinRef, type ProjectDocument } from '@robosim/shared';
import { memo } from 'react';
import { BoardArt, PartArt } from './art.js';
import { pinNamesOf } from './document.js';
import {
  BOARD_FOOTPRINT,
  PITCH,
  boardPlacement,
  footprintOf,
  place,
  snap,
  type Footprint,
  type Placement,
  type Point,
} from './geometry.js';
import type { CircuitNets } from './nets.js';
import type { Selection } from './use-circuit-editor.js';
import { WIRE_COLORS } from './view.js';

/*
 * The canvas content in document mm, split into memoised layers: panning and zooming only change the root
 * transform, and a drag re-renders just the parts, pins and wires that move (FR-CIR-06: 60 FPS at 200 parts
 * and 400 wires).
 */

/** Hit size of a breadboard hole: smaller than the pitch, so the board itself can be grabbed between holes. */
const HOLE_HIT = PITCH * 0.7;
const ACCENT = '#0ea5e9';

function SelectionBox({ fp }: { fp: Footprint }) {
  const { x, y, w, h } = fp.box;
  return (
    <rect
      x={x - 0.3}
      y={y - 0.3}
      width={w + 0.6}
      height={h + 0.6}
      fill="none"
      stroke={ACCENT}
      strokeWidth={0.15}
      strokeDasharray="0.5 0.3"
      pointerEvents="none"
    />
  );
}

const PartNode = memo(function PartNode({
  c,
  dx,
  dy,
  selected,
  live,
  cursor,
  damagedLabel,
}: {
  c: ComponentInstance;
  dx: number;
  dy: number;
  selected: boolean;
  live: unknown;
  cursor: string;
  /** Shown over the part when the damage model broke it (icon + text, FR-SIM-10). */
  damagedLabel: string | null;
}) {
  const fp = footprintOf(c.type, pinNamesOf(c.type));
  const transform = `translate(${c.x + dx} ${c.y + dy}) rotate(${c.rotation}) scale(${c.flipped ? -PITCH : PITCH} ${PITCH})`;
  const { x, y, w, h } = fp.box;
  return (
    <g data-part-body={c.id} transform={transform} className={cursor}>
      <PartArt type={c.type} props={c.props} live={live} label={c.id} />
      {damagedLabel && (
        <g pointerEvents="none">
          <rect
            x={x - 0.2}
            y={y - 0.2}
            width={w + 0.4}
            height={h + 0.4}
            fill="#fecaca88"
            stroke="#dc2626"
            strokeWidth={0.15}
            strokeDasharray="0.6 0.3"
          />
          <text
            x={x + w / 2}
            y={y - 0.8}
            fontSize={0.9}
            textAnchor="middle"
            fill="#b91c1c"
            transform={c.flipped ? `translate(${2 * (x + w / 2)} 0) scale(-1 1)` : undefined}
          >
            {`💥 ${damagedLabel}`}
          </text>
        </g>
      )}
      {selected && <SelectionBox fp={fp} />}
    </g>
  );
});

const BoardNode = memo(function BoardNode({
  x,
  y,
  rotation,
  selected,
  cursor,
}: {
  x: number;
  y: number;
  rotation: number;
  selected: boolean;
  cursor: string;
}) {
  return (
    <g
      data-part-body={BOARD_PART}
      transform={`translate(${x} ${y}) rotate(${rotation}) scale(${PITCH})`}
      className={cursor}
    >
      <BoardArt />
      {selected && <SelectionBox fp={BOARD_FOOTPRINT} />}
    </g>
  );
});

/** Hit targets of one part's pins (circles) or a breadboard's holes (squares). */
const PinTargets = memo(function PinTargets({
  part,
  at,
  fp,
  dx,
  dy,
  holes,
  editing,
}: {
  part: string;
  at: Placement;
  fp: Footprint;
  dx: number;
  dy: number;
  holes: boolean;
  editing: boolean;
}) {
  const cursor = editing ? 'cursor-crosshair' : '';
  return (
    <>
      {Object.entries(fp.pins).map(([pin, p]) => {
        const [x, y] = place(at, p);
        return holes ? (
          <rect
            key={pin}
            data-part={part}
            data-pin={pin}
            x={x + dx - HOLE_HIT / 2}
            y={y + dy - HOLE_HIT / 2}
            width={HOLE_HIT}
            height={HOLE_HIT}
            fill="transparent"
            className={cursor}
            pointerEvents={editing ? undefined : 'none'}
          />
        ) : (
          <circle
            key={pin}
            data-part={part}
            data-pin={pin}
            cx={x + dx}
            cy={y + dy}
            r={0.9}
            fill="transparent"
            className={cursor}
          />
        );
      })}
    </>
  );
});

const WireNode = memo(function WireNode({
  id,
  d,
  color,
  selected,
  bends,
}: {
  id: string;
  d: string;
  color: string;
  selected: boolean;
  /** Bend handles, only for the selected wire. */
  bends: readonly Point[] | null;
}) {
  return (
    <g data-wire={id} className="cursor-pointer">
      <path d={d} fill="none" stroke="transparent" strokeWidth={2.4} />
      {selected && (
        <path d={d} fill="none" stroke={ACCENT} strokeWidth={1.5} strokeLinejoin="round" opacity={0.5} />
      )}
      <path
        d={d}
        fill="none"
        stroke={WIRE_COLORS[color] ?? color}
        strokeWidth={0.8}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {bends?.map((p, i) => (
        <circle
          key={i}
          data-bend={`${id}:${i}`}
          cx={p[0]}
          cy={p[1]}
          r={0.9}
          fill="#fff"
          stroke={ACCENT}
          strokeWidth={0.3}
          className="cursor-grab"
        />
      ))}
    </g>
  );
});

const wirePath = (pts: readonly Point[]): string =>
  pts.map((p, i) => `${i ? 'L' : 'M'} ${p[0]} ${p[1]}`).join(' ');

export interface SceneProps {
  doc: ProjectDocument;
  nets: CircuitNets;
  selection: Selection;
  editing: boolean;
  /** Parts following a drag (with the board's passengers), and the grid-snapped drag offset. */
  dragged: ReadonlySet<string>;
  dx: number;
  dy: number;
  /** A wire bend point being dragged. */
  bend: { readonly wire: string; readonly index: number; readonly at: Point } | null;
  drawing: { readonly from: PinRef; readonly points: readonly Point[]; readonly cursor: Point } | null;
  hover: PinRef | null;
  live: Readonly<Record<string, unknown>> | undefined;
  /** Parts that respond to a click while running. */
  interactive: ReadonlySet<string>;
  damaged: ReadonlySet<string>;
  damagedText: string;
  /** Wiring-guide view: these parts and wires stay in full colour, the rest is faded. */
  focus?: { readonly parts: ReadonlySet<string>; readonly wires: ReadonlySet<string> } | null;
}

/** Opacity of everything outside a `focus`. */
const FADED = 0.18;

export const Scene = memo(function Scene({
  doc,
  nets,
  selection,
  editing,
  dragged,
  dx,
  dy,
  bend,
  drawing,
  hover,
  live,
  interactive,
  damaged,
  damagedText,
  focus = null,
}: SceneProps) {
  const fade = (on: boolean) => (focus && !on ? FADED : undefined);
  const byId = new Map(doc.components.map((c) => [c.id, c]));
  const board = boardPlacement(doc);
  const shiftOf = (part: string): Point => (dragged.has(part) ? [dx, dy] : [0, 0]);
  const pinAt = (ref: PinRef): Point | null => {
    const at = ref.part === BOARD_PART ? board : byId.get(ref.part);
    const type = ref.part === BOARD_PART ? null : (at as ComponentInstance | undefined)?.type;
    const fp = type === null ? BOARD_FOOTPRINT : type ? footprintOf(type, pinNamesOf(type)) : null;
    const p = fp?.pins[ref.pin];
    if (!at || !p) return null;
    const [x, y] = place(at, p);
    const [sx, sy] = shiftOf(ref.part);
    return [x + sx, y + sy];
  };
  const selected = new Set(editing ? selection.parts : []);
  const cursorOf = (id: string): string =>
    editing ? 'cursor-move' : interactive.has(id) ? 'cursor-pointer' : '';
  // Drawing order as on a real desk: breadboards, their holes, then the parts plugged into them,
  // so a part on a breadboard is grabbed, not the hole underneath it.
  const breadboards = doc.components.filter((c) => breadboardLayout(c.type));
  const parts = doc.components.filter((c) => !breadboardLayout(c.type));
  const partNode = (c: ComponentInstance) => {
    const [sx, sy] = shiftOf(c.id);
    return (
      <g key={c.id} opacity={fade(focus?.parts.has(c.id) ?? true)}>
        <PartNode
          c={c}
          dx={sx}
          dy={sy}
          selected={selected.has(c.id)}
          live={live?.[c.id]}
          cursor={cursorOf(c.id)}
          damagedLabel={damaged.has(c.id) ? damagedText : null}
        />
      </g>
    );
  };
  const pinsOf = (c: ComponentInstance, holes: boolean) => {
    const [sx, sy] = shiftOf(c.id);
    return (
      <PinTargets
        key={c.id}
        part={c.id}
        at={c}
        fp={footprintOf(c.type, pinNamesOf(c.type))}
        dx={sx}
        dy={sy}
        holes={holes}
        editing={editing}
      />
    );
  };
  const [bx, by] = shiftOf(BOARD_PART);
  const hoverAt = hover ? pinAt(hover) : null;
  const hoverIsHole = hover ? breadboardLayout(byId.get(hover.part)?.type ?? '') !== undefined : false;

  return (
    <>
      <g opacity={fade(focus?.parts.has(BOARD_PART) ?? true)}>
        <BoardNode
          x={board.x + bx}
          y={board.y + by}
          rotation={board.rotation}
          selected={selected.has(BOARD_PART)}
          cursor={cursorOf(BOARD_PART)}
        />
      </g>
      {breadboards.map(partNode)}
      {breadboards.map((c) => pinsOf(c, true))}
      {parts.map(partNode)}
      {doc.wires.map((w) => {
        const a = pinAt(w.from);
        const b = pinAt(w.to);
        if (!a || !b) return null;
        const points = w.points.map((p, i) =>
          bend && bend.wire === w.id && bend.index === i
            ? ([snap(bend.at[0]), snap(bend.at[1])] as Point)
            : p,
        );
        const isSelected = editing && selection.wire === w.id;
        const focused = focus?.wires.has(w.id) ?? false;
        return (
          <g key={w.id} opacity={fade(focused)}>
            <WireNode
              id={w.id}
              d={wirePath([a, ...points, b])}
              color={w.color}
              selected={isSelected || focused}
              bends={isSelected ? points : null}
            />
          </g>
        );
      })}
      <PinTargets
        part={BOARD_PART}
        at={board}
        fp={BOARD_FOOTPRINT}
        dx={bx}
        dy={by}
        holes={false}
        editing={editing}
      />
      {parts.map((c) => pinsOf(c, false))}
      {hoverAt &&
        (hoverIsHole ? (
          <rect
            x={hoverAt[0] - HOLE_HIT / 2}
            y={hoverAt[1] - HOLE_HIT / 2}
            width={HOLE_HIT}
            height={HOLE_HIT}
            fill={`${ACCENT}55`}
            stroke={ACCENT}
            strokeWidth={0.25}
            pointerEvents="none"
          />
        ) : (
          <circle
            cx={hoverAt[0]}
            cy={hoverAt[1]}
            r={0.9}
            fill="none"
            stroke={ACCENT}
            strokeWidth={0.3}
            pointerEvents="none"
          />
        ))}
      {hover &&
        nets.connectedTo(hover).map((ref) => {
          const at = pinAt(ref);
          return at ? (
            <circle
              key={`${ref.part}.${ref.pin}`}
              cx={at[0]}
              cy={at[1]}
              r={0.75}
              fill="none"
              stroke={ACCENT}
              strokeWidth={0.35}
              pointerEvents="none"
            />
          ) : null;
        })}
      {drawing &&
        (() => {
          const from = pinAt(drawing.from);
          return from ? (
            <path
              d={wirePath([from, ...drawing.points, drawing.cursor])}
              fill="none"
              stroke={ACCENT}
              strokeWidth={0.6}
              strokeDasharray="1.2 0.8"
              pointerEvents="none"
            />
          ) : null;
        })()}
    </>
  );
});
