import { breadboardLayout } from '@robosim/catalog/manifests';
import { BOARD_PART, type ProjectDocument } from '@robosim/shared';
import { forwardRef, useMemo } from 'react';
import { pinNamesOf } from './document.js';
import { boardBox, footprintOf, pinPosition, placedBox, type Box } from './geometry.js';
import { CircuitNets } from './nets.js';
import { Scene } from './scene.js';
import { NO_SELECTION } from './use-circuit-editor.js';
import { contentBox } from './view.js';

const NONE: ReadonlySet<string> = new Set();
const MARGIN = 6; // mm around the drawn content

export interface PictureFocus {
  readonly parts: ReadonlySet<string>;
  readonly wires: ReadonlySet<string>;
}

/** The area a focus needs: its parts (breadboards only when nothing else is there) and its wires. */
export function focusBox(doc: ProjectDocument, focus: PictureFocus): Box {
  const byId = new Map(doc.components.map((c) => [c.id, c]));
  const solid = [...focus.parts].filter(
    (id) => id === BOARD_PART || !breadboardLayout(byId.get(id)?.type ?? ''),
  );
  const boxes: Box[] = (solid.length ? solid : [...focus.parts]).flatMap((id) => {
    if (id === BOARD_PART) return [boardBox(doc)];
    const c = byId.get(id);
    return c ? [placedBox(c, footprintOf(c.type, pinNamesOf(c.type)))] : [];
  });
  for (const w of doc.wires) {
    if (!focus.wires.has(w.id)) continue;
    const points = [pinPosition(doc, w.from, pinNamesOf), pinPosition(doc, w.to, pinNamesOf), ...w.points];
    for (const p of points) if (p) boxes.push({ x: p[0], y: p[1], w: 0, h: 0 });
  }
  if (!boxes.length) return contentBox(doc);
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * A still picture of the circuit (no interaction): the whole drawing for image export, or a step of
 * the wiring guide with its parts and wire in colour and everything else faded (FR-BOM-04, FR-BOM-05).
 */
export const CircuitPicture = forwardRef<
  SVGSVGElement,
  { doc: ProjectDocument; focus?: PictureFocus | null; label: string; className?: string }
>(function CircuitPicture({ doc, focus = null, label, className }, ref) {
  const nets = useMemo(() => new CircuitNets(doc), [doc]);
  const box = focus ? focusBox(doc, focus) : contentBox(doc);
  const viewBox = `${box.x - MARGIN} ${box.y - MARGIN} ${box.w + 2 * MARGIN} ${box.h + 2 * MARGIN}`;
  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={viewBox}
      role="img"
      aria-label={label}
      className={className}
      pointerEvents="none"
    >
      <Scene
        doc={doc}
        nets={nets}
        selection={NO_SELECTION}
        editing={false}
        dragged={NONE}
        dx={0}
        dy={0}
        bend={null}
        drawing={null}
        hover={null}
        live={undefined}
        interactive={NONE}
        damaged={NONE}
        damagedText=""
        focus={focus}
      />
    </svg>
  );
});
