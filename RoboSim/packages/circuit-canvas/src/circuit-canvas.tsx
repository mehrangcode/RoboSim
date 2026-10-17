import { breadboardLayout, findManifest } from '@robosim/catalog/manifests';
import { BOARD_PART, type ComponentInstance, type PinRef } from '@robosim/shared';
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type KeyboardEvent,
  type DragEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { BoardArt, PartArt } from './art.js';
import {
  addComponent,
  addWire,
  conventionalColor,
  deleteComponents,
  deleteWires,
  flipComponents,
  moveComponents,
  moveWirePoint,
  pinNamesOf,
  rotateComponents,
} from './document.js';
import {
  BOARD_FOOTPRINT,
  PITCH,
  footprintOf,
  pinPosition,
  place,
  placedBox,
  snap,
  type Point,
} from './geometry.js';
import { InputPopover } from './input-popover.js';
import { interactionOf } from './interaction.js';
import { CircuitNets } from './nets.js';
import type { CircuitEditorState } from './use-circuit-editor.js';
import { MAX_K, MIN_K, PART_DRAG_TYPE, WIRE_COLORS, contentBox, fitView, type View } from './view.js';

type Drag =
  | {
      readonly kind: 'parts';
      readonly ids: readonly string[];
      readonly start: Point;
      readonly delta: Point;
      readonly moved: boolean;
    }
  | { readonly kind: 'pan'; readonly start: Point; readonly view: View }
  | { readonly kind: 'bend'; readonly wire: string; readonly index: number; readonly at: Point };

interface Drawing {
  readonly from: PinRef;
  readonly points: readonly Point[];
  readonly cursor: Point;
}

const WIRE_DEFAULT = 'yellow';
const ZOOM_BUTTONS = [
  { key: 'zoomIn', glyph: '+' },
  { key: 'zoomOut', glyph: '−' },
  { key: 'zoomFit', glyph: '⤢' },
] as const;

/** Hit size of a breadboard hole: smaller than the pitch, so the board itself can be grabbed between holes. */
const HOLE_HIT = PITCH * 0.7;

const samePin = (a: PinRef | null, b: PinRef | null) => !!a && !!b && a.part === b.part && a.pin === b.pin;

function pinFromTarget(target: EventTarget | null): PinRef | null {
  const el = (target as Element | null)?.closest?.('[data-pin]');
  const part = el?.getAttribute('data-part');
  const pin = el?.getAttribute('data-pin');
  return part && pin ? { part, pin } : null;
}

const attr = (target: EventTarget | null, name: string): string | null =>
  (target as Element | null)?.closest?.(`[${name}]`)?.getAttribute(name) ?? null;

/** edit: build the circuit · run: interact with parts of the running simulation · view: look only. */
export type CanvasMode = 'edit' | 'run' | 'view';

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
      {selected && (
        <rect
          x={x - 0.3}
          y={y - 0.3}
          width={w + 0.6}
          height={h + 0.6}
          fill="none"
          stroke="#0ea5e9"
          strokeWidth={0.15}
          strokeDasharray="0.5 0.3"
          pointerEvents="none"
        />
      )}
    </g>
  );
});

/**
 * The breadboard-style circuit canvas (ADR-005): React SVG with one root transform for pan and zoom.
 * Parts drag on the 0.1" grid, wires run pin to pin with bend points, hovering a pin highlights its net.
 */
export function CircuitCanvas({
  editor,
  live,
  className,
  mode = 'edit',
  onInput,
  damaged,
}: {
  editor: CircuitEditorState;
  /** Live part states by component id (from the running simulation). */
  live?: Readonly<Record<string, unknown>> | undefined;
  className?: string | undefined;
  mode?: CanvasMode | undefined;
  /** A user input to a part during a run (FR-SIM-11): button press, switch, knob, sensor level. */
  onInput?: ((componentId: string, name: string, value: number | boolean) => void) | undefined;
  /** Ids of parts the damage model has broken. */
  damaged?: readonly string[] | undefined;
}) {
  const { t } = useTranslation();
  const { doc, apply, selection, setSelection, viewCenterRef } = editor;
  const svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 800, height: 520 });
  const [view, setView] = useState<View>(() => fitView(contentBox(doc), 800, 520));
  const [drag, setDrag] = useState<Drag | null>(null);
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [hover, setHover] = useState<{ pin: PinRef; at: Point } | null>(null);
  /** Part whose input popover is open, and the button held down (run mode). */
  const [inspecting, setInspecting] = useState<string | null>(null);
  const [pressing, setPressing] = useState<{ id: string; input: string } | null>(null);
  /** Values sent to inputs the live state does not report (line-sensor surfaces…). */
  const [sent, setSent] = useState<Readonly<Record<string, Readonly<Record<string, number | boolean>>>>>({});
  const nets = useMemo(() => new CircuitNets(doc), [doc]);
  const editing = mode === 'edit';
  const running = mode === 'run' && onInput !== undefined;
  const [prevMode, setPrevMode] = useState(mode);
  if (prevMode !== mode) {
    setPrevMode(mode);
    setInspecting(null);
    setDrawing(null);
    setSent({});
  }

  const inputValue = (id: string, name: string, fallback: number | boolean): number | boolean => {
    const own = sent[id]?.[name];
    if (own !== undefined) return own;
    const state = (live?.[id] ?? null) as Record<string, unknown> | null;
    const v = state?.[name];
    if (typeof v === 'number' || typeof v === 'boolean') return v;
    return doc.components.find((c) => c.id === id)?.inputs?.[name] ?? fallback;
  };
  const sendInput = (id: string, name: string, value: number | boolean) => {
    setSent((s) => ({ ...s, [id]: { ...s[id], [name]: value } }));
    onInput?.(id, name, value);
  };

  // Track the element size; fit the content when the real size is first known (again after a
  // project change, whose panes may resize the canvas).
  const fitted = useRef(false);
  const docRef = useRef(doc);
  useEffect(() => {
    docRef.current = doc;
  });
  useEffect(() => {
    const el = svg.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry?.contentRect ?? { width: 0, height: 0 };
      if (width < 10 || height < 10) return;
      setSize({ width, height });
      if (!fitted.current) {
        fitted.current = true;
        setView(fitView(contentBox(docRef.current), width, height));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A different project (new / open / import): show all of it.
  const [fittedGeneration, setFittedGeneration] = useState(editor.generation);
  if (fittedGeneration !== editor.generation) {
    setFittedGeneration(editor.generation);
    setView(fitView(contentBox(doc), size.width, size.height));
  }
  useEffect(() => {
    fitted.current = false;
  }, [editor.generation]);

  useEffect(() => {
    viewCenterRef.current = [(size.width / 2 - view.x) / view.k, (size.height / 2 - view.y) / view.k];
  }, [view, size, viewCenterRef]);

  const toDoc = useCallback(
    (clientX: number, clientY: number): Point => {
      const r = svg.current?.getBoundingClientRect();
      return [(clientX - (r?.left ?? 0) - view.x) / view.k, (clientY - (r?.top ?? 0) - view.y) / view.k];
    },
    [view],
  );

  const zoomBy = useCallback(
    (factor: number, around?: Point) => {
      setView((v) => {
        const k = Math.min(MAX_K, Math.max(MIN_K, v.k * factor));
        const [px, py] = around ?? [size.width / 2, size.height / 2];
        return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
      });
    },
    [size],
  );
  const zoomToFit = useCallback(
    () => setView(fitView(contentBox(doc), size.width, size.height)),
    [doc, size],
  );

  // Wheel zoom around the cursor; a native listener, because React's wheel listener is passive.
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomBy(Math.exp(-e.deltaY * 0.0015), [e.clientX - r.left, e.clientY - r.top]);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  // Parts that follow a drag: the dragged ones plus parts plugged only into a dragged breadboard.
  const draggedSet = useMemo(() => {
    if (drag?.kind !== 'parts') return new Set<string>();
    const set = new Set(drag.ids);
    for (const c of doc.components) {
      const seats = Object.values(c.seats ?? {});
      if (seats.length > 0 && seats.every((s) => set.has(s.part))) set.add(c.id);
    }
    return set;
  }, [drag, doc]);
  const dragDelta: Point = drag?.kind === 'parts' ? [snap(drag.delta[0]), snap(drag.delta[1])] : [0, 0];
  const shift = (part: string): Point => (draggedSet.has(part) ? dragDelta : [0, 0]);

  /** Pin position including an in-progress drag of its part. */
  const pinAt = (ref: PinRef): Point | null => {
    const p = pinPosition(doc, ref, pinNamesOf);
    const [dx, dy] = shift(ref.part);
    return p && [p[0] + dx, p[1] + dy];
  };

  const finishWire = (to: PinRef) => {
    if (!drawing) return;
    if (!samePin(drawing.from, to)) {
      apply(
        (d) =>
          addWire(d, drawing.from, to, drawing.points, conventionalColor(drawing.from, to, WIRE_DEFAULT)).doc,
      );
    }
    setDrawing(null);
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    svg.current?.focus();
    const at = toDoc(e.clientX, e.clientY);
    if (!editing) {
      const part = attr(e.target, 'data-part-body');
      const c = part ? doc.components.find((v) => v.id === part) : undefined;
      const inputs = c && running ? (findManifest(c.type)?.inputs ?? []) : [];
      const how = c && running ? interactionOf(inputs) : null;
      // A button drawn inside a part (a keypad key, a joystick's push) is held where it is drawn.
      const drawn = attr(e.target, 'data-input');
      const button = inputs.find((i) => i.name === drawn && i.type === 'boolean');
      if (c && button && e.button === 0) {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        setPressing({ id: c.id, input: button.name });
        sendInput(c.id, button.name, true);
        return;
      }
      if (c && how && how.kind !== 'keys' && e.button === 0) {
        if (how.kind === 'momentary') {
          e.currentTarget.setPointerCapture?.(e.pointerId);
          setPressing({ id: c.id, input: how.input });
          sendInput(c.id, how.input, true);
        } else if (how.kind === 'toggle') sendInput(c.id, how.input, !inputValue(c.id, how.input, false));
        else setInspecting(c.id);
        return;
      }
      setInspecting(null);
      e.currentTarget.setPointerCapture?.(e.pointerId);
      setDrag({ kind: 'pan', start: [e.clientX, e.clientY], view });
      return;
    }
    const pin = pinFromTarget(e.target);
    if (pin && e.button === 0) {
      e.stopPropagation();
      if (drawing) finishWire(pin);
      else setDrawing({ from: pin, points: [], cursor: at });
      return;
    }
    if (drawing && e.button === 0) {
      setDrawing({ ...drawing, points: [...drawing.points, [snap(at[0]), snap(at[1])]] });
      return;
    }
    const bend = attr(e.target, 'data-bend');
    if (bend && e.button === 0) {
      const [wire = '', index = '0'] = bend.split(':');
      e.currentTarget.setPointerCapture?.(e.pointerId);
      setDrag({ kind: 'bend', wire, index: Number(index), at });
      return;
    }
    const wire = attr(e.target, 'data-wire');
    if (wire && e.button === 0) {
      setSelection({ parts: [], wire });
      return;
    }
    const part = attr(e.target, 'data-part-body');
    if (part && e.button === 0) {
      const ids = e.shiftKey
        ? selection.parts.includes(part)
          ? selection.parts.filter((p) => p !== part)
          : [...selection.parts, part]
        : selection.parts.includes(part)
          ? selection.parts
          : [part];
      setSelection({ parts: ids, wire: null });
      if (ids.includes(part)) {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        setDrag({ kind: 'parts', ids, start: at, delta: [0, 0], moved: false });
      }
      return;
    }
    if (!e.shiftKey) setSelection({ parts: [], wire: null });
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ kind: 'pan', start: [e.clientX, e.clientY], view });
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const at = toDoc(e.clientX, e.clientY);
    if (drawing) setDrawing({ ...drawing, cursor: at });
    if (!drag) return;
    if (drag.kind === 'pan')
      setView({
        ...drag.view,
        x: drag.view.x + e.clientX - drag.start[0],
        y: drag.view.y + e.clientY - drag.start[1],
      });
    else if (drag.kind === 'parts') {
      const delta: Point = [at[0] - drag.start[0], at[1] - drag.start[1]];
      setDrag({ ...drag, delta, moved: drag.moved || Math.hypot(delta[0], delta[1]) > PITCH / 2 });
    } else setDrag({ ...drag, at });
  };

  const onPointerUp = () => {
    if (pressing) {
      sendInput(pressing.id, pressing.input, false);
      setPressing(null);
    }
    if (drag?.kind === 'parts' && drag.moved)
      apply((d) => moveComponents(d, drag.ids, drag.delta[0], drag.delta[1]));
    if (drag?.kind === 'bend') apply((d) => moveWirePoint(d, drag.wire, drag.index, drag.at));
    setDrag(null);
  };

  const onPointerOver = (e: PointerEvent<SVGSVGElement>) => {
    const pin = pinFromTarget(e.target);
    if (!pin) return setHover(null);
    const at = pinPosition(doc, pin, pinNamesOf);
    if (at && !samePin(pin, hover?.pin ?? null)) setHover({ pin, at });
  };

  const removeSelection = () => {
    if (selection.wire) {
      const id = selection.wire;
      apply((d) => deleteWires(d, [id]));
    } else if (selection.parts.length > 0) {
      const ids = selection.parts;
      apply((d) => deleteComponents(d, ids));
    }
    setSelection({ parts: [], wire: null });
  };

  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    const mod = e.ctrlKey || e.metaKey;
    const ids = selection.parts;
    if (!editing) {
      if (e.key === 'Escape') setInspecting(null);
      return;
    }
    if (e.key === 'Escape') {
      setDrawing(null);
      setSelection({ parts: [], wire: null });
    } else if (e.key === 'Delete' || e.key === 'Backspace') removeSelection();
    else if (mod && e.key.toLowerCase() === 'z') (e.shiftKey ? editor.redo : editor.undo)();
    else if (mod && e.key.toLowerCase() === 'y') editor.redo();
    else if (!mod && e.key.toLowerCase() === 'r' && ids.length) apply((d) => rotateComponents(d, ids));
    else if (!mod && e.key.toLowerCase() === 'f' && ids.length) apply((d) => flipComponents(d, ids));
    else if (e.key.startsWith('Arrow') && ids.length) {
      const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key] ?? [
        0, 0,
      ];
      apply((d) => moveComponents(d, ids, (step[0] ?? 0) * PITCH, (step[1] ?? 0) * PITCH));
    } else return;
    e.preventDefault();
  };

  const onDrop = (e: DragEvent<SVGSVGElement>) => {
    const type = e.dataTransfer.getData(PART_DRAG_TYPE);
    if (!type || !editing) return;
    e.preventDefault();
    const at = toDoc(e.clientX, e.clientY);
    let id = '';
    apply((d) => {
      const added = addComponent(d, type, at);
      id = added.id;
      return added.doc;
    });
    setSelection({ parts: [id], wire: null });
  };

  // Pins as hit targets: the board header, every part pin; breadboard holes are pins too.
  const pinTargets: { ref: PinRef; at: Point; hole: boolean }[] = [];
  for (const [pin, p] of Object.entries(BOARD_FOOTPRINT.pins))
    pinTargets.push({
      ref: { part: BOARD_PART, pin },
      at: place({ x: 0, y: 0, rotation: 0, flipped: false }, p),
      hole: false,
    });
  const holes: typeof pinTargets = [];
  for (const c of doc.components) {
    const [dx, dy] = shift(c.id);
    const hole = breadboardLayout(c.type) !== undefined;
    for (const [pin, p] of Object.entries(footprintOf(c.type, pinNamesOf(c.type)).pins)) {
      const [x, y] = place(c, p);
      (hole ? holes : pinTargets).push({ ref: { part: c.id, pin }, at: [x + dx, y + dy], hole });
    }
  }
  const highlighted = hover ? nets.connectedTo(hover.pin) : [];
  // Drawing order as on a real desk: breadboards, their holes, then the parts plugged into them,
  // so a part on a breadboard is grabbed, not the hole underneath it.
  const breadboards = doc.components.filter((c) => breadboardLayout(c.type));
  const parts = doc.components.filter((c) => !breadboardLayout(c.type));
  const selectedParts = new Set(editing ? selection.parts : []);
  const broken = new Set(damaged ?? []);
  const damagedText = t('editor:canvas.damaged');
  const cursorOf = (c: ComponentInstance): string =>
    editing
      ? 'cursor-move'
      : running && interactionOf(findManifest(c.type)?.inputs ?? [])
        ? 'cursor-pointer'
        : '';
  const inspected = inspecting ? doc.components.find((c) => c.id === inspecting) : undefined;
  const partNode = (c: ComponentInstance) => {
    const [dx, dy] = shift(c.id);
    return (
      <PartNode
        key={c.id}
        c={c}
        dx={dx}
        dy={dy}
        selected={selectedParts.has(c.id)}
        live={live?.[c.id]}
        cursor={cursorOf(c)}
        damagedLabel={broken.has(c.id) ? damagedText : null}
      />
    );
  };

  const wirePath = (pts: readonly Point[]) => pts.map((p, i) => `${i ? 'L' : 'M'} ${p[0]} ${p[1]}`).join(' ');

  return (
    <div
      dir="ltr"
      className={`relative overflow-hidden rounded-md border border-line bg-[#f1f5f9] ${className ?? ''}`}
    >
      <svg
        ref={svg}
        tabIndex={0}
        role="application"
        aria-label={t('editor:canvas.label')}
        aria-describedby="circuit-canvas-help"
        className="block h-full w-full touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-accent"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerOver={onPointerOver}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKeyDown}
        onDragOver={(e) => e.dataTransfer.types.includes(PART_DRAG_TYPE) && e.preventDefault()}
        onDrop={onDrop}
      >
        <defs>
          <pattern id="circuit-grid" width={PITCH * 4} height={PITCH * 4} patternUnits="userSpaceOnUse">
            <circle cx={0} cy={0} r={0.25} fill="#cbd5e1" />
          </pattern>
        </defs>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          <rect x={-2000} y={-2000} width={4000} height={4000} fill="url(#circuit-grid)" />
          <g transform={`scale(${PITCH})`}>
            <BoardArt />
          </g>
          {breadboards.map(partNode)}
          {holes.map(({ ref, at }) => {
            const hovered = samePin(ref, hover?.pin ?? null);
            return (
              <rect
                key={`${ref.part}.${ref.pin}`}
                data-part={ref.part}
                data-pin={ref.pin}
                x={at[0] - HOLE_HIT / 2}
                y={at[1] - HOLE_HIT / 2}
                width={HOLE_HIT}
                height={HOLE_HIT}
                fill={hovered ? '#0ea5e955' : 'transparent'}
                stroke={hovered ? '#0ea5e9' : 'none'}
                strokeWidth={0.25}
                className={editing ? 'cursor-crosshair' : ''}
                pointerEvents={editing ? undefined : 'none'}
              />
            );
          })}
          {parts.map(partNode)}
          {doc.wires.map((w) => {
            const a = pinAt(w.from);
            const b = pinAt(w.to);
            if (!a || !b) return null;
            const points = w.points.map((p, i) =>
              drag?.kind === 'bend' && drag.wire === w.id && drag.index === i
                ? ([snap(drag.at[0]), snap(drag.at[1])] as Point)
                : p,
            );
            const d = wirePath([a, ...points, b]);
            const selected = editing && selection.wire === w.id;
            return (
              <g key={w.id} data-wire={w.id} className="cursor-pointer">
                <path d={d} fill="none" stroke="transparent" strokeWidth={2.4} />
                {selected && (
                  <path
                    d={d}
                    fill="none"
                    stroke="#0ea5e9"
                    strokeWidth={1.5}
                    strokeLinejoin="round"
                    opacity={0.5}
                  />
                )}
                <path
                  d={d}
                  fill="none"
                  stroke={WIRE_COLORS[w.color] ?? w.color}
                  strokeWidth={0.8}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {selected &&
                  points.map((p, i) => (
                    <circle
                      key={i}
                      data-bend={`${w.id}:${i}`}
                      cx={p[0]}
                      cy={p[1]}
                      r={0.9}
                      fill="#fff"
                      stroke="#0ea5e9"
                      strokeWidth={0.3}
                      className="cursor-grab"
                    />
                  ))}
              </g>
            );
          })}
          {pinTargets.map(({ ref, at }) => (
            <circle
              key={`${ref.part}.${ref.pin}`}
              data-part={ref.part}
              data-pin={ref.pin}
              cx={at[0]}
              cy={at[1]}
              r={0.9}
              fill="transparent"
              stroke={samePin(ref, hover?.pin ?? null) ? '#0ea5e9' : 'transparent'}
              strokeWidth={0.3}
              className={editing ? 'cursor-crosshair' : ''}
            />
          ))}
          {highlighted.map((ref) => {
            const at = pinAt(ref);
            return at ? (
              <circle
                key={`${ref.part}.${ref.pin}`}
                cx={at[0]}
                cy={at[1]}
                r={0.75}
                fill="none"
                stroke="#0ea5e9"
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
                  stroke="#0ea5e9"
                  strokeWidth={0.6}
                  strokeDasharray="1.2 0.8"
                  pointerEvents="none"
                />
              ) : null;
            })()}
        </g>
      </svg>
      {hover && (
        <div
          role="tooltip"
          dir="ltr"
          className="pointer-events-none absolute rounded bg-ink px-1.5 py-0.5 font-mono text-xs text-surface"
          style={{ left: hover.at[0] * view.k + view.x + 10, top: hover.at[1] * view.k + view.y - 28 }}
        >
          {hover.pin.part === BOARD_PART ? `Uno · ${hover.pin.pin}` : `${hover.pin.part} · ${hover.pin.pin}`}
        </div>
      )}
      <div className="absolute end-2 top-2 flex gap-1">
        {ZOOM_BUTTONS.map(({ key, glyph }) => (
          <button
            key={key}
            type="button"
            title={t(`editor:canvas.${key}`)}
            aria-label={t(`editor:canvas.${key}`)}
            onClick={() => (key === 'zoomFit' ? zoomToFit() : zoomBy(key === 'zoomIn' ? 1.25 : 0.8))}
            className="size-7 rounded border border-line bg-surface text-sm shadow-sm hover:bg-surface-raised"
          >
            {glyph}
          </button>
        ))}
      </div>
      {inspected &&
        (() => {
          const box = placedBox(inspected, footprintOf(inspected.type, pinNamesOf(inspected.type)));
          return (
            <InputPopover
              part={inspected}
              inputs={findManifest(inspected.type)?.inputs ?? []}
              value={(name, fallback) => inputValue(inspected.id, name, fallback)}
              onChange={(name, value) => sendInput(inspected.id, name, value)}
              onClose={() => setInspecting(null)}
              left={Math.max(4, Math.min(size.width - 240, (box.x + box.w) * view.k + view.x + 8))}
              top={Math.max(4, Math.min(size.height - 160, box.y * view.k + view.y))}
            />
          );
        })()}
      <p id="circuit-canvas-help" className="absolute bottom-1 start-2 m-0 text-xs text-ink-muted">
        {mode === 'run'
          ? t('editor:canvas.runHelp')
          : mode === 'view'
            ? t('editor:canvas.viewHelp')
            : drawing
              ? t('editor:canvas.drawing')
              : t('editor:canvas.help')}
      </p>
    </div>
  );
}
