import { findManifest } from '@robosim/catalog/manifests';
import { BOARD_PART, type PinRef } from '@robosim/shared';
import {
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
import { AlignToolbar } from './align-toolbar.js';
import {
  addComponent,
  addWire,
  alignComponents,
  alignableCount,
  conventionalColor,
  deleteComponents,
  deleteWires,
  distributeComponents,
  duplicateComponents,
  flipComponents,
  moveComponents,
  moveWirePoint,
  partBox,
  passengersOf,
  pinNamesOf,
  rotateComponents,
} from './document.js';
import { PITCH, footprintOf, pinPosition, placedBox, samePin, snap, type Point } from './geometry.js';
import { InputPopover } from './input-popover.js';
import { interactionOf } from './interaction.js';
import { Minimap } from './minimap.js';
import { CircuitNets } from './nets.js';
import { Scene } from './scene.js';
import type { CircuitEditorState } from './use-circuit-editor.js';
import { MAX_K, MIN_K, PART_DRAG_TYPE, contentBox, fitView, type View } from './view.js';

type Drag =
  | {
      readonly kind: 'parts';
      readonly ids: readonly string[];
      readonly start: Point;
      readonly delta: Point;
      readonly moved: boolean;
    }
  | { readonly kind: 'pan'; readonly start: Point; readonly view: View }
  | { readonly kind: 'bend'; readonly wire: string; readonly index: number; readonly at: Point }
  /** Rubber-band selection; `add` keeps the parts selected before (Shift). */
  | { readonly kind: 'box'; readonly start: Point; readonly at: Point; readonly add: boolean };

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
const MINIMAP_KEY = 'robosim.circuit.minimap';
const NONE = new Set<string>();

function pinFromTarget(target: EventTarget | null): PinRef | null {
  const el = (target as Element | null)?.closest?.('[data-pin]');
  const part = el?.getAttribute('data-part');
  const pin = el?.getAttribute('data-pin');
  return part && pin ? { part, pin } : null;
}

const attr = (target: EventTarget | null, name: string): string | null =>
  (target as Element | null)?.closest?.(`[${name}]`)?.getAttribute(name) ?? null;

function loadMinimap(): boolean {
  try {
    return localStorage.getItem(MINIMAP_KEY) !== 'off';
  } catch {
    return true;
  }
}

/** edit: build the circuit · run: interact with parts of the running simulation · view: look only. */
export type CanvasMode = 'edit' | 'run' | 'view';

/**
 * The breadboard-style circuit canvas (ADR-005): React SVG with one root transform for pan and zoom.
 * Parts drag on the 0.1" grid, wires run pin to pin with bend points, hovering a pin highlights its net.
 * Dragging the background selects parts inside the band; Space + drag, the middle button or touch pans.
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
  const [minimap, setMinimap] = useState(loadMinimap);
  /** Space held: a left drag pans instead of selecting. */
  const [spaceDown, setSpaceDown] = useState(false);
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
  const centerOn = useCallback(
    ([x, y]: Point) => setView((v) => ({ ...v, x: size.width / 2 - x * v.k, y: size.height / 2 - y * v.k })),
    [size],
  );
  const toggleMinimap = () =>
    setMinimap((on) => {
      try {
        localStorage.setItem(MINIMAP_KEY, on ? 'off' : 'on');
      } catch {
        // Private mode or blocked storage: the toggle still works for this page.
      }
      return !on;
    });

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

  // Parts that follow a drag: the dragged ones plus a dragged breadboard's passengers.
  const dragIds = drag?.kind === 'parts' ? drag.ids : null;
  const dragged = useMemo(
    () => (dragIds ? new Set([...dragIds, ...passengersOf(doc, dragIds)]) : NONE),
    [dragIds, doc],
  );
  const dx = drag?.kind === 'parts' ? snap(drag.delta[0]) : 0;
  const dy = drag?.kind === 'parts' ? snap(drag.delta[1]) : 0;
  const interactive = useMemo(
    () =>
      running
        ? new Set(
            doc.components.filter((c) => interactionOf(findManifest(c.type)?.inputs ?? [])).map((c) => c.id),
          )
        : NONE,
    [running, doc],
  );
  const broken = useMemo(() => new Set(damaged ?? []), [damaged]);

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

  const startPan = (e: PointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ kind: 'pan', start: [e.clientX, e.clientY], view });
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    svg.current?.focus();
    const at = toDoc(e.clientX, e.clientY);
    if (e.button === 1 || (spaceDown && e.button === 0)) {
      e.preventDefault();
      return startPan(e);
    }
    if (!editing) {
      const part = attr(e.target, 'data-part-body');
      const c = part ? doc.components.find((v) => v.id === part) : undefined;
      const inputs = c && running ? (findManifest(c.type)?.inputs ?? []) : [];
      const how = c && running ? interactionOf(inputs) : null;
      // A button drawn inside a part (a keypad key, a joystick's push) is held where it is drawn.
      const drawn = attr(e.target, 'data-input');
      const button = inputs.find((i) => i.name === drawn && i.type === 'boolean');
      if (c && button) {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        setPressing({ id: c.id, input: button.name });
        sendInput(c.id, button.name, true);
        return;
      }
      if (c && how && how.kind !== 'keys') {
        if (how.kind === 'momentary') {
          e.currentTarget.setPointerCapture?.(e.pointerId);
          setPressing({ id: c.id, input: how.input });
          sendInput(c.id, how.input, true);
        } else if (how.kind === 'toggle') sendInput(c.id, how.input, !inputValue(c.id, how.input, false));
        else setInspecting(c.id);
        return;
      }
      setInspecting(null);
      return startPan(e);
    }
    const pin = pinFromTarget(e.target);
    if (pin) {
      e.stopPropagation();
      if (drawing) finishWire(pin);
      else setDrawing({ from: pin, points: [], cursor: at });
      return;
    }
    if (drawing) {
      setDrawing({ ...drawing, points: [...drawing.points, [snap(at[0]), snap(at[1])]] });
      return;
    }
    const bend = attr(e.target, 'data-bend');
    if (bend) {
      const [wire = '', index = '0'] = bend.split(':');
      e.currentTarget.setPointerCapture?.(e.pointerId);
      setDrag({ kind: 'bend', wire, index: Number(index), at });
      return;
    }
    const wire = attr(e.target, 'data-wire');
    if (wire) {
      setSelection({ parts: [], wire });
      return;
    }
    const part = attr(e.target, 'data-part-body');
    if (part) {
      const toggle = e.shiftKey || e.ctrlKey || e.metaKey;
      const ids = toggle
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
    // Touch has no hover or modifier keys: a finger on the background pans.
    if (e.pointerType === 'touch') return startPan(e);
    if (!e.shiftKey) setSelection({ parts: [], wire: null });
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ kind: 'box', start: at, at, add: e.shiftKey });
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
    if (drag?.kind === 'box') {
      // Parts (and the board) entirely inside the band.
      const x0 = Math.min(drag.start[0], drag.at[0]);
      const x1 = Math.max(drag.start[0], drag.at[0]);
      const y0 = Math.min(drag.start[1], drag.at[1]);
      const y1 = Math.max(drag.start[1], drag.at[1]);
      const inside = [BOARD_PART, ...doc.components.map((c) => c.id)].filter((id) => {
        const b = partBox(doc, id);
        return b && b.x >= x0 && b.y >= y0 && b.x + b.w <= x1 && b.y + b.h <= y1;
      });
      if (inside.length > 0 || !drag.add)
        setSelection({
          parts: drag.add ? [...new Set([...selection.parts, ...inside])] : inside,
          wire: null,
        });
    }
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

  // `apply` runs its updater later, so the new ids come from the same pure edit on the current document.
  const duplicate = (ids: readonly string[]) => {
    apply((d) => duplicateComponents(d, ids).doc);
    setSelection({ parts: duplicateComponents(doc, ids).ids, wire: null });
  };

  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    const ids = selection.parts;
    if (e.key === ' ') {
      setSpaceDown(true);
      e.preventDefault();
      return;
    }
    if (!mod && key === 'm') {
      toggleMinimap();
      e.preventDefault();
      return;
    }
    if (!editing) {
      if (e.key === 'Escape') setInspecting(null);
      return;
    }
    if (e.key === 'Escape') {
      setDrawing(null);
      setSelection({ parts: [], wire: null });
    } else if (e.key === 'Delete' || e.key === 'Backspace') removeSelection();
    else if (mod && key === 'z') (e.shiftKey ? editor.redo : editor.undo)();
    else if (mod && key === 'y') editor.redo();
    else if (mod && key === 'a')
      setSelection({ parts: [BOARD_PART, ...doc.components.map((c) => c.id)], wire: null });
    else if (mod && key === 'd' && ids.length) duplicate(ids);
    else if (!mod && key === 'r' && ids.length) apply((d) => rotateComponents(d, ids));
    else if (!mod && key === 'f' && ids.length) apply((d) => flipComponents(d, ids));
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
    apply((d) => addComponent(d, type, at).doc);
    setSelection({ parts: [addComponent(doc, type, at).id], wire: null });
  };

  const inspected = inspecting ? doc.components.find((c) => c.id === inspecting) : undefined;
  const alignable = editing && selection.parts.length > 1 ? alignableCount(doc, selection.parts) : 0;
  const band =
    drag?.kind === 'box'
      ? {
          x: Math.min(drag.start[0], drag.at[0]),
          y: Math.min(drag.start[1], drag.at[1]),
          w: Math.abs(drag.at[0] - drag.start[0]),
          h: Math.abs(drag.at[1] - drag.start[1]),
        }
      : null;
  const panning = drag?.kind === 'pan' || spaceDown;

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
        className={`block h-full w-full touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-accent ${panning ? 'cursor-grab' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerOver={onPointerOver}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKeyDown}
        onKeyUp={(e) => e.key === ' ' && setSpaceDown(false)}
        onBlur={() => setSpaceDown(false)}
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
          <Scene
            doc={doc}
            nets={nets}
            selection={selection}
            editing={editing}
            dragged={dragged}
            dx={dx}
            dy={dy}
            bend={drag?.kind === 'bend' ? drag : null}
            drawing={drawing}
            hover={hover?.pin ?? null}
            live={live}
            interactive={interactive}
            damaged={broken}
            damagedText={t('editor:canvas.damaged')}
          />
          {band && (
            <rect
              data-testid="selection-band"
              x={band.x}
              y={band.y}
              width={band.w}
              height={band.h}
              fill="#0ea5e91a"
              stroke="#0ea5e9"
              strokeWidth={1 / view.k}
              strokeDasharray={`${4 / view.k} ${3 / view.k}`}
              pointerEvents="none"
            />
          )}
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
      {alignable > 1 && (
        <div className="absolute start-2 top-2">
          <AlignToolbar
            count={alignable}
            onAlign={(how) => apply((d) => alignComponents(d, selection.parts, how))}
            onDistribute={(axis) => apply((d) => distributeComponents(d, selection.parts, axis))}
          />
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
        <button
          type="button"
          title={t('editor:canvas.minimapToggle')}
          aria-label={t('editor:canvas.minimapToggle')}
          aria-pressed={minimap}
          onClick={toggleMinimap}
          className="grid size-7 place-items-center rounded border border-line bg-surface shadow-sm hover:bg-surface-raised aria-pressed:bg-surface-raised"
        >
          <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true" fill="none" stroke="currentColor">
            <rect x={1.5} y={2.5} width={13} height={11} rx={1} />
            <rect x={7.5} y={8} width={5} height={3.5} fill="currentColor" stroke="none" />
          </svg>
        </button>
      </div>
      {minimap && (
        <div className="absolute bottom-6 end-2">
          <Minimap doc={doc} view={view} size={size} label={t('editor:canvas.minimap')} onCenter={centerOn} />
        </div>
      )}
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
