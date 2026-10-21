import { breadboardLayout } from '@robosim/catalog/manifests';
import { BOARD_PART, type ProjectDocument } from '@robosim/shared';
import { memo, useMemo, useRef, type PointerEvent } from 'react';
import { partBox } from './document.js';
import type { Box, Point } from './geometry.js';
import { contentBox, type View } from './view.js';

const W = 168;
const H = 112;

/** The whole circuit, padded by a quarter on every side, in minimap pixels. */
function frame(doc: ProjectDocument): { world: Box; s: number; ox: number; oy: number } {
  const c = contentBox(doc);
  const world = { x: c.x - c.w / 4, y: c.y - c.h / 4, w: c.w * 1.5, h: c.h * 1.5 };
  const s = Math.min(W / world.w, H / world.h);
  return { world, s, ox: (W - world.w * s) / 2 - world.x * s, oy: (H - world.h * s) / 2 - world.y * s };
}

const Parts = memo(function Parts({ doc }: { doc: ProjectDocument }) {
  const { s, ox, oy } = frame(doc);
  const boxes = [
    { id: BOARD_PART, fill: '#0f766e' },
    ...doc.components.map((c) => ({ id: c.id, fill: breadboardLayout(c.type) ? '#e2e8f0' : '#64748b' })),
  ];
  return (
    <>
      {boxes.map(({ id, fill }) => {
        const b = partBox(doc, id);
        return b ? (
          <rect key={id} x={ox + b.x * s} y={oy + b.y * s} width={b.w * s} height={b.h * s} fill={fill} />
        ) : null;
      })}
    </>
  );
});

/**
 * Overview of the circuit with the visible area outlined (FR-CIR-06). Click or drag on it to move the view
 * there; the canvas can also be panned directly, so the minimap is a pointer shortcut only.
 */
export function Minimap({
  doc,
  view,
  size,
  label,
  onCenter,
}: {
  doc: ProjectDocument;
  view: View;
  size: { readonly width: number; readonly height: number };
  label: string;
  /** Centre the canvas view on a document point (mm). */
  onCenter: (at: Point) => void;
}) {
  const { s, ox, oy } = useMemo(() => frame(doc), [doc]);
  const dragging = useRef(false);
  const toDoc = (e: PointerEvent<SVGSVGElement>): Point => {
    const r = e.currentTarget.getBoundingClientRect();
    return [(e.clientX - r.left - ox) / s, (e.clientY - r.top - oy) / s];
  };
  const visible = {
    x: -view.x / view.k,
    y: -view.y / view.k,
    w: size.width / view.k,
    h: size.height / view.k,
  };
  return (
    <svg
      role="img"
      aria-label={label}
      width={W}
      height={H}
      data-testid="circuit-minimap"
      className="cursor-pointer rounded border border-line bg-surface/90 shadow-sm"
      onPointerDown={(e) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        dragging.current = true;
        onCenter(toDoc(e));
      }}
      onPointerMove={(e) => dragging.current && onCenter(toDoc(e))}
      onPointerUp={() => {
        dragging.current = false;
      }}
    >
      <Parts doc={doc} />
      <rect
        x={ox + visible.x * s}
        y={oy + visible.y * s}
        width={visible.w * s}
        height={visible.h * s}
        fill="#0ea5e922"
        stroke="#0ea5e9"
        strokeWidth={1.5}
        pointerEvents="none"
      />
    </svg>
  );
}
