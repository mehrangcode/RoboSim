import type { PoseProblem } from '@robosim/content/arenas';
import {
  ArenaRenderer,
  FIT_CAMERA,
  handlePoint,
  headingTowards,
  hitsRobot,
  toCanvas,
  toWorld,
  zoomAt,
  type ArenaView as ArenaModel,
  type Camera,
  type Point,
  type Pose,
} from '@robosim/renderer-2d';
import type { ProjectDocument } from '@robosim/shared';
import type { Frame, RobotScene } from '@robosim/sim-runtime/client';
import { cn } from '@robosim/ui';
import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormat } from '../lab/format.js';
import { overlayOf } from './arena-model.js';

const VIEW_KEY = 'robosim.arena.view.v1';
const SNAP_RAD = Math.PI / 12; // 15°
const HANDLE_HIT_PX = 14;
const FOLLOW_MIN_ZOOM = 2;

interface ViewPrefs {
  readonly follow: boolean;
  readonly trail: boolean;
  readonly overlays: boolean;
}

const DEFAULT_PREFS: ViewPrefs = { follow: false, trail: true, overlays: false };

function loadPrefs(): ViewPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null') as Partial<ViewPrefs> | null;
    return { ...DEFAULT_PREFS, ...(raw ?? {}) };
  } catch {
    return DEFAULT_PREFS;
  }
}

/** Start-pose editing while nothing runs (FR-ARN-06). */
export interface PoseEdit {
  readonly pose: Pose;
  readonly check: (pose: Pose) => PoseProblem | null;
  readonly onChange: (pose: Pose) => void;
}

type Drag =
  | { readonly kind: 'pan'; readonly from: Point; readonly center: Point }
  | { readonly kind: 'move'; readonly offset: Point }
  | { readonly kind: 'rotate' };

/**
 * The 2D arena view (FR-ARN-07): zoom (wheel, buttons, +/−/0), pan (drag), follow the robot, the
 * driven path, a sensor/wheel overlay, and — when `edit` is given — dragging the start pose.
 */
export function ArenaView({
  arena,
  robot,
  frame = null,
  project,
  edit = null,
  label,
  className = 'aspect-[3/2] w-full rounded-lg border border-line',
  footer,
}: {
  arena: ArenaModel;
  robot: RobotScene | null;
  frame?: Frame | null;
  /** The running project, for sensor geometry the overlay needs (line sensor spacing). */
  project?: ProjectDocument | undefined;
  edit?: PoseEdit | null;
  label: string;
  /** Size of the canvas box; the arena is letterboxed into it. */
  className?: string;
  footer?: ReactNode;
}) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<ArenaRenderer | null>(null);
  const [prefs, setPrefs] = useState(loadPrefs);
  const [camera, setCamera] = useState<Camera>(FIT_CAMERA);
  /** Re-render (and so redraw) after the canvas was resized. */
  const [, resized] = useReducer((n: number) => n + 1, 0);
  const [draft, setDraft] = useState<Pose | null>(null);
  /** Why the last drag was refused, for the pose it started from (stale once the pose changes). */
  const [rejected, setRejected] = useState<{ problem: PoseProblem; from: string } | null>(null);
  const drag = useRef<Drag | null>(null);

  const setPref = (key: keyof ViewPrefs, value: boolean) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify(next));
    } catch {
      // Private mode: the toggles just do not persist.
    }
  };

  // One renderer per arena + robot; it keeps the trail across frames.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    rendererRef.current = new ArenaRenderer(ctx, arena, robot);
    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
      rendererRef.current?.resize();
      resized();
    };
    fit();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
    observer?.observe(canvas);
    return () => {
      observer?.disconnect();
      rendererRef.current = null;
    };
  }, [arena, robot]);

  const pose = frame?.robot ?? null;
  const following = prefs.follow && pose !== null && !edit;
  const effectiveCamera: Camera = following
    ? { zoom: Math.max(camera.zoom, FOLLOW_MIN_ZOOM), center: { x: pose.x, y: pose.y } }
    : camera;

  const overlay = useMemo(
    () =>
      prefs.overlays && pose && robot && frame && project
        ? overlayOf(robot, pose, frame.parts, project, fmt, {
            cm: (value) => t('shell:arena.units.cm', { value }),
            mps: (value) => t('shell:arena.units.mps', { value }),
            noEcho: t('shell:arena.units.noEcho'),
          })
        : null,
    [prefs.overlays, pose, robot, frame, project, fmt, t],
  );

  const shown = draft ?? edit?.pose ?? null;
  const shownProblem = shown && edit ? edit.check(shown) : null;

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    if (frame?.simTime === 0) r.clearTrail();
    r.setCamera(effectiveCamera);
    r.draw({
      pose,
      zones: frame?.challenge ?? null,
      obstacles: frame?.obstacles,
      overlay,
      trail: prefs.trail,
      handle: shown ? { pose: shown, valid: shownProblem === null } : null,
    });
  });

  // Wheel zoom needs a non-passive listener to keep the page from scrolling.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const at = canvasPoint(canvas, e);
      setCamera((c) => zoomAt(arena, canvas.width, canvas.height, c, at, Math.exp(-e.deltaY * 0.0015)));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [arena]);

  const zoomBy = (factor: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const at = { x: canvas.width / 2, y: canvas.height / 2 };
    setCamera((c) => zoomAt(arena, canvas.width, canvas.height, following ? effectiveCamera : c, at, factor));
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = rendererRef.current;
    const canvas = canvasRef.current;
    if (!r || !canvas || e.button !== 0) return;
    const at = canvasPoint(canvas, e);
    const world = toWorld(r.view, at);
    if (edit && robot) {
      const h = toCanvas(r.view, handlePoint(robot, edit.pose));
      if (Math.hypot(h.x - at.x, h.y - at.y) <= HANDLE_HIT_PX * (window.devicePixelRatio || 1)) {
        drag.current = { kind: 'rotate' };
      } else if (hitsRobot(robot, edit.pose, world)) {
        drag.current = { kind: 'move', offset: { x: edit.pose.x - world.x, y: edit.pose.y - world.y } };
      }
    }
    if (!drag.current) {
      const c = effectiveCamera.center ?? { x: arena.widthM / 2, y: arena.heightM / 2 };
      drag.current = { kind: 'pan', from: world, center: c };
      if (following) {
        setPref('follow', false);
        setCamera(effectiveCamera);
      }
    }
    canvas.setPointerCapture?.(e.pointerId);
    setRejected(null);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = rendererRef.current;
    const canvas = canvasRef.current;
    const d = drag.current;
    if (!r || !canvas || !d) return;
    const at = canvasPoint(canvas, e);
    if (d.kind === 'pan') {
      // Pan in the transform of the drag start, so the grabbed point stays under the pointer.
      const world = toWorld(r.view, at);
      const c = effectiveCamera.center ?? d.center;
      setCamera({
        zoom: effectiveCamera.zoom,
        center: { x: c.x - (world.x - d.from.x), y: c.y - (world.y - d.from.y) },
      });
      return;
    }
    if (!edit) return;
    const world = toWorld(r.view, at);
    const base = draft ?? edit.pose;
    setDraft(
      d.kind === 'move'
        ? { ...base, x: world.x + d.offset.x, y: world.y + d.offset.y }
        : { ...base, angle: headingTowards(base, world, e.shiftKey ? SNAP_RAD : 0) },
    );
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.kind === 'pan' || !edit || !draft) return;
    const problem = edit.check(draft);
    if (problem) setRejected({ problem, from: poseKey(edit.pose) });
    else edit.onChange(draft);
    setDraft(null);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === '+' || e.key === '=') zoomBy(1.25);
    else if (e.key === '-') zoomBy(0.8);
    else if (e.key === '0') setCamera(FIT_CAMERA);
    else return;
    e.preventDefault();
  };

  const problem = shownProblem ?? (edit && rejected?.from === poseKey(edit.pose) ? rejected.problem : null);
  const toggles: { key: keyof ViewPrefs; label: string }[] = [
    { key: 'follow', label: t('shell:arena.view.follow') },
    { key: 'trail', label: t('shell:arena.view.trail') },
    { key: 'overlays', label: t('shell:arena.view.overlays') },
  ];
  const button = 'rounded border border-line bg-surface/90 px-1.5 py-0.5 text-xs hover:bg-surface-raised';

  return (
    <div className="flex h-full min-h-0 flex-col gap-1">
      <div className="relative min-h-0 flex-1">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={label}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
          className={cn('touch-none bg-surface', edit ? 'cursor-move' : 'cursor-grab', className)}
        />
        <div
          role="toolbar"
          aria-label={t('shell:arena.view.toolbar')}
          className="absolute end-1 top-1 flex flex-wrap gap-1"
        >
          <button
            type="button"
            className={button}
            onClick={() => zoomBy(1.25)}
            aria-label={t('shell:arena.view.zoomIn')}
          >
            +
          </button>
          <button
            type="button"
            className={button}
            onClick={() => zoomBy(0.8)}
            aria-label={t('shell:arena.view.zoomOut')}
          >
            −
          </button>
          <button
            type="button"
            className={button}
            onClick={() => {
              setCamera(FIT_CAMERA);
              if (prefs.follow) setPref('follow', false);
            }}
          >
            {t('shell:arena.view.fit')}
          </button>
          {toggles.map(({ key, label: text }) => (
            <button
              key={key}
              type="button"
              aria-pressed={prefs[key]}
              className={cn(button, prefs[key] && 'border-brand-600 bg-brand-600/15 text-brand-600')}
              onClick={() => setPref(key, !prefs[key])}
            >
              {text}
            </button>
          ))}
        </div>
      </div>
      {edit && (
        <p aria-live="polite" className={cn('px-1 text-xs', problem ? 'text-danger' : 'text-ink-muted')}>
          {problem
            ? problem.kind === 'outside'
              ? t('shell:arena.pose.outside')
              : t('shell:arena.pose.obstacle', { id: problem.id })
            : t('shell:arena.pose.hint')}
        </p>
      )}
      {footer}
    </div>
  );
}

const poseKey = (p: Pose): string => `${p.x},${p.y},${p.angle}`;

function canvasPoint(canvas: HTMLCanvasElement, e: { clientX: number; clientY: number }): Point {
  const rect = canvas.getBoundingClientRect();
  const sx = rect.width > 0 ? canvas.width / rect.width : 1;
  const sy = rect.height > 0 ? canvas.height / rect.height : 1;
  return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
}
