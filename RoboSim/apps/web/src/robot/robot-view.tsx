import { findManifest } from '@robosim/catalog/manifests';
import { NO_SELECTION, type CircuitEditorState } from '@robosim/circuit-canvas';
import {
  FRONT_OVERHANG_MM,
  MAX_MOUNT_HEIGHT_MM,
  boxCorners,
  type MountPose,
  type MountProblem,
} from '@robosim/component-chassis-2wd/mounting';
import { SegmentedControl, cn } from '@robosim/ui';
import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { NumberField } from '../arena/start-pose-fields.js';
import { useFormat } from '../lab/format.js';
import {
  BOARD_ID,
  boxOf,
  chassisOf,
  checkMount,
  defaultBoardMount,
  defaultMount,
  massOf,
  motorMount,
  mountablesOf,
  moveTo,
  overlapsOf,
  setChassisProp,
  setMount,
  yawTowards,
  type Chassis,
  type Mountable,
} from './robot-model.js';

/** Drag payload type for parts dragged from the tray onto the chassis. */
const MOUNT_DRAG_TYPE = 'application/x-robosim-mount';
const WHEEL_WIDTH_MM = 26;
const FIELD = 'flex items-center justify-between gap-1';
const MARGIN_MM = 25;
/** Rotate handle distance ahead of the part (mm). */
const HANDLE_MM = 12;

interface Pt {
  readonly x: number;
  readonly y: number;
}

/** Robot frame (mm; +x forward, +y left) → SVG (forward up, left on the left). */
const toSvg = (p: Pt): [number, number] => [-p.y, -p.x];
const points = (pts: readonly (readonly [number, number])[]) =>
  pts.map(([x, y]) => toSvg({ x, y }).join(',')).join(' ');

const FILL: Readonly<Record<string, string>> = {
  board: '#0f7c9a',
  sensor: '#0d9488',
  actuator: '#d97706',
  driver: '#4f46e5',
  power: '#dc2626',
  passive: '#78716c',
  semiconductor: '#57534e',
  ic: '#1f2937',
  display: '#7c3aed',
};
const fillOf = (p: Mountable): string =>
  FILL[p.id === BOARD_ID ? 'board' : (findManifest(p.type)?.category ?? 'passive')] ?? '#78716c';

type Drag =
  | { readonly kind: 'move'; readonly id: string; readonly offset: Pt; readonly preview: MountPose }
  | { readonly kind: 'rotate'; readonly id: string; readonly preview: MountPose };

/**
 * Mounting editor (FR-ARN-09; US-ARN-06): the chassis from above. Drag parts to move them (slots
 * snap, Shift is free), turn them with the handle (15° steps), or use the exact fields. Positions
 * off the chassis are refused; overlapping parts are warned about. Wheels are chassis props.
 */
export function RobotView({
  editor,
  disabled,
  className,
}: {
  editor: CircuitEditorState;
  disabled: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const { doc, apply } = editor;
  const chassis = useMemo(() => chassisOf(doc), [doc]);
  const parts = useMemo(() => mountablesOf(doc), [doc]);
  const overlaps = useMemo(() => overlapsOf(doc), [doc]);
  const mass = useMemo(() => massOf(doc), [doc]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [refused, setRefused] = useState<MountProblem | null>(null);
  const svg = useRef<SVGSVGElement>(null);

  if (!chassis) return <p className="p-3 text-sm text-ink-muted">{t('shell:robot.noChassis')}</p>;

  const selected = parts.find((p) => p.id === selectedId) ?? null;
  const nameOf = (p: Mountable) =>
    p.id === BOARD_ID
      ? t('shell:robot.board')
      : `${t(`components:${findManifest(p.type)?.nameKey ?? p.type}`)} (${p.id})`;
  const select = (id: string | null) => {
    setSelectedId(id);
    setRefused(null);
    editor.setSelection(id && id !== BOARD_ID ? { parts: [id], wire: null } : NO_SELECTION);
  };
  /** Commits a pose as one undo step, unless the rules refuse it. */
  const commit = (part: Mountable, mount: MountPose | null) => {
    const problem = mount ? checkMount(chassis, part, mount) : null;
    setRefused(problem);
    if (problem) return;
    apply((d) => setMount(d, part.id, mount));
  };
  const putOn = (part: Mountable, at?: Pt) => {
    const base = defaultMount(doc, part.id);
    if (!base) return;
    const mount = at ? moveTo(chassis, part, base, at, false).mount : base;
    select(part.id);
    commit(part, mount);
  };

  // Pointer → robot frame (mm).
  const pointer = (e: { clientX: number; clientY: number }): Pt | null => {
    const m = svg.current?.getScreenCTM?.();
    if (!m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: -p.y, y: -p.x };
  };
  const onPartDown = (e: PointerEvent, part: Mountable, kind: Drag['kind']) => {
    e.stopPropagation();
    select(part.id);
    const at = pointer(e);
    if (disabled || !part.mount || !at) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setDrag(
      kind === 'move'
        ? {
            kind,
            id: part.id,
            offset: { x: at.x - part.mount.x, y: at.y - part.mount.y },
            preview: part.mount,
          }
        : { kind, id: part.id, preview: part.mount },
    );
  };
  const onMove = (e: PointerEvent) => {
    const part = drag && parts.find((p) => p.id === drag.id);
    const at = pointer(e);
    if (!drag || !part?.mount || !at) return;
    if (drag.kind === 'move') {
      const r = moveTo(
        chassis,
        part,
        part.mount,
        { x: at.x - drag.offset.x, y: at.y - drag.offset.y },
        e.shiftKey,
      );
      setDrag({ ...drag, preview: r.mount });
      setRefused(r.problem);
    } else {
      setDrag({ ...drag, preview: { ...part.mount, yaw: yawTowards(part.mount, at, e.shiftKey) } });
    }
  };
  const onUp = () => {
    const part = drag && parts.find((p) => p.id === drag.id);
    setDrag(null);
    if (!drag || !part?.mount) return;
    const m = drag.preview;
    const p = part.mount;
    if (m.x !== p.x || m.y !== p.y || m.z !== p.z || m.yaw !== p.yaw) commit(part, m);
  };
  const onKey = (e: KeyboardEvent, part: Mountable) => {
    if (disabled || !part.mount) return;
    const step = e.shiftKey ? 10 : 1;
    const m = part.mount;
    const nudge: Readonly<Record<string, Pt>> = {
      ArrowUp: { x: step, y: 0 },
      ArrowDown: { x: -step, y: 0 },
      ArrowLeft: { x: 0, y: step },
      ArrowRight: { x: 0, y: -step },
    };
    const d = nudge[e.key];
    if (d) {
      if (part.motor) {
        if (d.y !== 0) commit(part, motorMount(chassis, d.y > 0 ? 'left' : 'right'));
      } else {
        const round = (v: number) => Math.round(v * 10) / 10;
        commit(part, { ...m, x: round(m.x + d.x), y: round(m.y + d.y) });
      }
    } else if ((e.key === 'r' || e.key === 'R') && !part.motor) {
      const yaw = m.yaw + (e.shiftKey ? -15 : 15);
      commit(part, { ...m, yaw: ((((yaw + 180) % 360) + 360) % 360) - 180 });
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && part.id !== BOARD_ID) {
      commit(part, null);
    } else return;
    e.preventDefault();
  };

  const mm = (v: number) => fmt(v, Number.isInteger(v) ? 0 : 1);
  const p = chassis.props;
  const half = Math.max(p.widthMm / 2, p.trackWidthMm / 2 + WHEEL_WIDTH_MM / 2) + MARGIN_MM;
  const minX = Math.min(p.bodyCenterXMm - p.lengthMm / 2, p.casterXMm - 10) - MARGIN_MM;
  const maxX = p.bodyCenterXMm + p.lengthMm / 2 + FRONT_OVERHANG_MM + MARGIN_MM;
  const plate = chassis.geometry.footprint.map((v) => [v.x * 1000, v.y * 1000] as const);
  const front = p.bodyCenterXMm + p.lengthMm / 2;
  const overhang = [
    [front, -p.widthMm / 2],
    [front + FRONT_OVERHANG_MM, -p.widthMm / 2],
    [front + FRONT_OVERHANG_MM, p.widthMm / 2],
    [front, p.widthMm / 2],
  ] as const;
  const overlapping = new Set(overlaps.flat());
  const shown = (part: Mountable): MountPose | null => (drag?.id === part.id ? drag.preview : part.mount);
  const mounted = parts.filter((x) => x.mount);
  // Low parts first so stacked ones stay visible; the selected part on top so it can be dragged.
  const rank = (x: Mountable) => (x.id === selectedId ? Infinity : (shown(x)?.z ?? 0));
  const drawOrder = [...mounted].sort((a, b) => rank(a) - rank(b));
  const motorsOk =
    parts.filter((x) => x.motor && x.mount && x.mount.y > 0).length === 1 &&
    parts.filter((x) => x.motor && x.mount && x.mount.y < 0).length === 1;
  const problemText = (k: MountProblem) =>
    k === 'height'
      ? t('shell:robot.problem.height', { max: fmt(MAX_MOUNT_HEIGHT_MM) })
      : t('shell:robot.problem.offChassis');

  return (
    // Side by side in a wide pane (the panel scrolls on its own), stacked in a narrow one.
    <div className={cn('@container h-full min-h-0', className)}>
      <div className="flex h-full min-h-0 flex-col gap-2 p-2 @xl:flex-row">
        <div className="relative min-h-[14rem] min-w-0 flex-1" dir="ltr">
          <svg
            ref={svg}
            role="group"
            aria-label={t('shell:robot.view')}
            viewBox={`${-half} ${-maxX} ${2 * half} ${maxX - minX}`}
            className="absolute inset-0 h-full w-full touch-none select-none"
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={() => setDrag(null)}
            onPointerDown={() => select(null)}
            onDragOver={(e) => {
              if (!disabled && e.dataTransfer.types.includes(MOUNT_DRAG_TYPE)) e.preventDefault();
            }}
            onDrop={(e) => {
              const part = parts.find((x) => x.id === e.dataTransfer.getData(MOUNT_DRAG_TYPE));
              const at = pointer(e);
              if (!part || !at) return;
              e.preventDefault();
              putOn(part, at);
            }}
          >
            <polygon points={points(overhang)} className="fill-none stroke-line" strokeDasharray="4 3" />
            {Object.entries({
              front: [0, -maxX + 9, 0],
              back: [0, -minX - 6, 0],
              left: [-half + 8, -(maxX + minX) / 2, -90],
              right: [half - 8, -(maxX + minX) / 2, 90],
            } as const).map(([side, [x, y, turn]]) => (
              <text
                key={side}
                data-testid={`robot-side-${side}`}
                x={x}
                y={y}
                transform={turn ? `rotate(${turn} ${x} ${y})` : undefined}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={9}
                letterSpacing={1}
                className="pointer-events-none fill-ink-muted font-semibold select-none"
              >
                {t(`shell:robot.edge.${side}`)}
              </text>
            ))}
            <polygon
              points={points(plate)}
              className="fill-surface-raised stroke-ink-muted"
              strokeWidth={1}
            />
            {chassis.geometry.wheels.map((w) => {
              const [u] = toSvg({ x: 0, y: w.position.y * 1000 });
              const d = w.radiusM * 2000;
              return (
                <rect
                  key={w.side}
                  x={u - WHEEL_WIDTH_MM / 2}
                  y={-d / 2}
                  width={WHEEL_WIDTH_MM}
                  height={d}
                  rx={4}
                  className="fill-ink/70"
                />
              );
            })}
            <circle
              cx={0}
              cy={-chassis.geometry.caster.x * 1000}
              r={8}
              className="fill-none stroke-ink-muted"
              strokeWidth={2}
            />
            <line
              x1={0}
              y1={-front + 8}
              x2={0}
              y2={-front - 6}
              className="stroke-ink-muted"
              strokeWidth={1.5}
            />
            <path d={`M -5 ${-front - 1} L 0 ${-front - 8} L 5 ${-front - 1}`} className="fill-ink-muted" />
            {chassis.geometry.mountSlots.map((s) => {
              const [u, v] = toSvg({ x: s.xMm, y: s.yMm });
              return (
                <g key={s.id} className="stroke-brand-500/60">
                  <title>{t(`shell:robot.slot.${s.id}`)}</title>
                  <circle cx={u} cy={v} r={4} fill="none" strokeWidth={1} />
                  <path d={`M ${u - 6} ${v} H ${u + 6} M ${u} ${v - 6} V ${v + 6}`} strokeWidth={0.6} />
                </g>
              );
            })}
            {drawOrder.map((part) => {
              const m = shown(part) as MountPose;
              const corners = boxCorners(boxOf(part, m));
              const isSel = part.id === selectedId;
              const bad = (isSel && refused !== null) || overlapping.has(part.id);
              const a = (m.yaw * Math.PI) / 180;
              const [hu, hv] = toSvg({
                x: m.x + Math.cos(a) * (part.lengthMm / 2 + HANDLE_MM),
                y: m.y + Math.sin(a) * (part.lengthMm / 2 + HANDLE_MM),
              });
              const [cu, cv] = toSvg(m);
              const [fu, fv] = toSvg({
                x: m.x + (Math.cos(a) * part.lengthMm) / 2,
                y: m.y + (Math.sin(a) * part.lengthMm) / 2,
              });
              return (
                <g key={part.id}>
                  <g
                    role="button"
                    tabIndex={0}
                    aria-label={t('shell:robot.partLabel', {
                      name: nameOf(part),
                      x: mm(m.x),
                      y: mm(m.y),
                      z: mm(m.z),
                      yaw: fmt(m.yaw),
                    })}
                    aria-pressed={isSel}
                    onPointerDown={(e) => onPartDown(e, part, 'move')}
                    onFocus={() => selectedId !== part.id && select(part.id)}
                    onKeyDown={(e) => onKey(e, part)}
                    className={cn(!disabled && 'cursor-move', 'outline-none')}
                  >
                    <polygon
                      points={corners.map(([x, y]) => toSvg({ x, y }).join(',')).join(' ')}
                      fill={fillOf(part)}
                      fillOpacity={0.55}
                      stroke={bad ? 'var(--color-danger)' : fillOf(part)}
                      strokeWidth={isSel ? 2.5 : 1.2}
                      strokeDasharray={bad ? '4 2' : undefined}
                    />
                    <circle cx={fu} cy={fv} r={2.2} fill={fillOf(part)} />
                    <text
                      x={cu}
                      y={cv}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={7}
                      className="pointer-events-none fill-ink font-semibold"
                    >
                      {part.id === BOARD_ID ? 'UNO' : part.id}
                    </text>
                  </g>
                  {isSel && !disabled && !part.motor && (
                    <circle
                      cx={hu}
                      cy={hv}
                      r={5}
                      className="cursor-grab fill-orange-500 stroke-white"
                      strokeWidth={1}
                      onPointerDown={(e) => onPartDown(e, part, 'rotate')}
                    >
                      <title>{t('shell:robot.rotateHandle')}</title>
                    </circle>
                  )}
                </g>
              );
            })}
            {mass && (
              <g aria-hidden className="pointer-events-none">
                <circle
                  cx={-mass.center.y * 1000}
                  cy={-mass.center.x * 1000}
                  r={5}
                  className="fill-white stroke-ink"
                  strokeWidth={1.2}
                />
                <path
                  d={`M ${-mass.center.y * 1000 - 5} ${-mass.center.x * 1000} h 10 M ${-mass.center.y * 1000} ${-mass.center.x * 1000 - 5} v 10`}
                  className="stroke-ink"
                  strokeWidth={1.2}
                />
              </g>
            )}
          </svg>
        </div>

        <aside className="flex min-w-0 shrink-0 flex-col gap-3 text-xs @xl:min-h-0 @xl:w-64 @xl:overflow-y-auto">
          {refused && (
            <p role="alert" className="text-danger">
              {problemText(refused)}
            </p>
          )}
          {selected ? (
            <SelectedPart
              part={selected}
              chassis={chassis}
              name={nameOf(selected)}
              disabled={disabled}
              onCommit={(m) => commit(selected, m)}
            />
          ) : (
            <p className="text-ink-muted">{t('shell:robot.selectHint')}</p>
          )}

          <section aria-labelledby="robot-on">
            <h3 id="robot-on" className="mb-1 font-semibold">
              {t('shell:robot.onRobot')}
            </h3>
            <ul className="flex flex-col gap-0.5">
              {mounted.map((x) => (
                <li key={x.id}>
                  <button
                    type="button"
                    aria-pressed={x.id === selectedId}
                    onClick={() => select(x.id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded px-1.5 py-0.5 text-start hover:bg-surface-raised',
                      x.id === selectedId && 'bg-surface-raised font-semibold',
                    )}
                  >
                    <span
                      aria-hidden
                      className="h-3 w-3 shrink-0 rounded-sm"
                      style={{ background: fillOf(x) }}
                    />
                    <span className="min-w-0 flex-1 truncate">{nameOf(x)}</span>
                    <span className="text-ink-muted tabular-nums">
                      {t('shell:robot.unit.g', { value: fmt(x.massG, x.massG < 10 ? 1 : 0) })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="robot-tray">
            <h3 id="robot-tray" className="mb-1 font-semibold">
              {t('shell:robot.tray')}
            </h3>
            {parts.filter((x) => !x.mount).length === 0 ? (
              <p className="text-ink-muted">{t('shell:robot.trayEmpty')}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {parts
                  .filter((x) => !x.mount)
                  .map((x) => (
                    <li
                      key={x.id}
                      draggable={!disabled}
                      onDragStart={(e) => e.dataTransfer.setData(MOUNT_DRAG_TYPE, x.id)}
                      className="flex items-center gap-2 rounded border border-line px-1.5 py-1"
                    >
                      <span
                        aria-hidden
                        className="h-3 w-3 shrink-0 rounded-sm"
                        style={{ background: fillOf(x) }}
                      />
                      <span className="min-w-0 flex-1 truncate">{nameOf(x)}</span>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => putOn(x)}
                        className="rounded border border-line px-1.5 hover:bg-surface-raised disabled:opacity-40"
                      >
                        {t('shell:robot.mount')}
                      </button>
                    </li>
                  ))}
              </ul>
            )}
          </section>

          <WheelFields
            chassis={chassis}
            disabled={disabled}
            onChange={(name, v) => apply((d) => setChassisProp(d, name, v))}
          />

          {mass && (
            <section aria-labelledby="robot-mass">
              <h3 id="robot-mass" className="mb-1 font-semibold">
                {t('shell:robot.mass.title')}
              </h3>
              <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 tabular-nums">
                <dt className="text-ink-muted">{t('shell:robot.mass.total')}</dt>
                <dd>{t('shell:robot.unit.g', { value: fmt(mass.massKg * 1000) })}</dd>
                <dt className="text-ink-muted">{t('shell:robot.mass.center')}</dt>
                <dd>
                  {t('shell:robot.mass.xy', {
                    x: fmt(mass.center.x * 1000, 1),
                    y: fmt(mass.center.y * 1000, 1),
                  })}
                </dd>
                <dt className="text-ink-muted">{t('shell:robot.mass.axle')}</dt>
                <dd>{t('shell:robot.unit.percent', { value: fmt(mass.axleShare * 100) })}</dd>
              </dl>
            </section>
          )}

          {(overlaps.length > 0 || !motorsOk) && (
            <section aria-labelledby="robot-warnings" className="text-amber-700 dark:text-amber-400">
              <h3 id="robot-warnings" className="mb-1 font-semibold">
                {t('shell:robot.warnings')}
              </h3>
              <ul className="list-disc ps-4">
                {!motorsOk && <li>{t('shell:robot.motorsNeeded')}</li>}
                {overlaps.map(([a, b]) => (
                  <li key={`${a}-${b}`}>
                    {t('shell:robot.overlap', {
                      a: a === BOARD_ID ? t('shell:robot.board') : a,
                      b: b === BOARD_ID ? t('shell:robot.board') : b,
                    })}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="text-[11px] text-ink-muted">{t('shell:robot.hint')}</p>
        </aside>
      </div>
    </div>
  );
}

function SelectedPart({
  part,
  chassis,
  name,
  disabled,
  onCommit,
}: {
  part: Mountable;
  chassis: Chassis;
  name: string;
  disabled: boolean;
  onCommit: (mount: MountPose | null) => void;
}) {
  const { t } = useTranslation();
  const m = part.mount;
  const round = (v: number) => Math.round(v * 10) / 10;
  return (
    <section aria-labelledby="robot-selected" className="flex flex-col gap-1.5">
      <h3 id="robot-selected" className="font-semibold">
        {name}
      </h3>
      {!m ? (
        <p className="text-ink-muted">{t('shell:robot.notMounted')}</p>
      ) : part.motor ? (
        <SegmentedControl
          label={t('shell:robot.side')}
          value={m.y > 0 ? 'left' : 'right'}
          options={(['left', 'right'] as const).map((v) => ({
            value: v,
            label: t(`shell:robot.sides.${v}`),
          }))}
          onChange={(v) => !disabled && onCommit(motorMount(chassis, v))}
        />
      ) : (
        <fieldset disabled={disabled} className="flex flex-col gap-1">
          <legend className="sr-only">{t('shell:robot.pose')}</legend>
          <NumberField
            label={t('shell:robot.field.x')}
            value={round(m.x)}
            step={1}
            disabled={disabled}
            className={FIELD}
            onCommit={(v) => onCommit({ ...m, x: v })}
          />
          <NumberField
            label={t('shell:robot.field.y')}
            value={round(m.y)}
            step={1}
            disabled={disabled}
            className={FIELD}
            onCommit={(v) => onCommit({ ...m, y: v })}
          />
          <NumberField
            label={t('shell:robot.field.z')}
            value={round(m.z)}
            step={1}
            disabled={disabled}
            className={FIELD}
            onCommit={(v) => onCommit({ ...m, z: v })}
          />
          <NumberField
            label={t('shell:robot.field.yaw')}
            value={round(m.yaw)}
            step={15}
            disabled={disabled}
            className={FIELD}
            onCommit={(v) => onCommit({ ...m, yaw: ((((v + 180) % 360) + 360) % 360) - 180 })}
          />
        </fieldset>
      )}
      {m && (
        <div className="flex gap-1">
          {part.id === BOARD_ID ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onCommit(defaultBoardMount(chassis))}
              className="rounded border border-line px-1.5 py-0.5 hover:bg-surface-raised disabled:opacity-40"
            >
              {t('shell:robot.boardDefault')}
            </button>
          ) : (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onCommit(null)}
              className="rounded border border-line px-1.5 py-0.5 hover:bg-surface-raised disabled:opacity-40"
            >
              {t('shell:robot.unmount')}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

const WHEEL_PROPS = ['trackWidthMm', 'wheelDiameterMm'] as const;

function WheelFields({
  chassis,
  disabled,
  onChange,
}: {
  chassis: Chassis;
  disabled: boolean;
  onChange: (name: (typeof WHEEL_PROPS)[number], value: number) => void;
}) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const manifest = findManifest('mechanical.chassis-2wd');
  const [error, setError] = useState<string | null>(null);
  return (
    <section aria-labelledby="robot-wheels">
      <h3 id="robot-wheels" className="mb-1 font-semibold">
        {t('shell:robot.wheels')}
      </h3>
      <fieldset disabled={disabled} className="flex flex-col gap-1">
        <legend className="sr-only">{t('shell:robot.wheels')}</legend>
        {WHEEL_PROPS.map((name) => {
          const spec = manifest?.props[name];
          const min = spec?.type === 'number' ? (spec.min ?? 0) : 0;
          const max = spec?.type === 'number' ? (spec.max ?? Infinity) : Infinity;
          return (
            <NumberField
              key={name}
              label={t(`shell:robot.field.${name}`)}
              value={chassis.props[name]}
              step={1}
              disabled={disabled}
              className={FIELD}
              onCommit={(v) => {
                if (v < min || v > max) {
                  setError(t('shell:robot.range', { min: fmt(min), max: fmt(max) }));
                  return;
                }
                setError(null);
                onChange(name, v);
              }}
            />
          );
        })}
        {error && (
          <span role="alert" className="text-danger">
            {error}
          </span>
        )}
      </fieldset>
    </section>
  );
}
