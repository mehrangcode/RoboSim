import { breadboardLayout } from '@robosim/catalog/manifests';
import type { ProbeArm } from '@robosim/circuit-canvas';
import type { MeasureProbe } from '@robosim/sim-runtime/client';
import type { PinRef, ProjectDocument } from '@robosim/shared';
import { Button, SegmentedControl } from '@robosim/ui';
import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatSi, useFormat } from './format.js';
import { decodePoint as decode, encodePoint as encode, ltr, pointOptions } from './probe-points.js';
import {
  ANNOUNCE_MS,
  DISPLAY_MS,
  EMPTY_METER,
  MODES,
  UNIT,
  useSampled,
  type MeterState,
  type MultimeterModel,
} from './use-multimeter.js';

/**
 * Multimeter dock panel (FR-SIM-13, US-SIM-09): V / A / Ω / P, autoranged FA/EN readout at ≈10 Hz
 * with min and max, probes placed on the canvas ("Place" arms the next click) or picked from lists.
 */
export function Multimeter({
  doc,
  meter,
  onAddToScope,
}: {
  doc: ProjectDocument;
  meter: MultimeterModel;
  /** Adds the meter's probe as an oscilloscope channel (FR-SIM-14); null: the scope is full. */
  onAddToScope?: ((probe: MeasureProbe) => void) | null;
}) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const { state, setState, run } = meter;
  const set = (patch: Partial<MeterState>) => setState((s) => ({ ...s, ...patch }));
  const arm = (a: ProbeArm) => set({ armed: state.armed === a ? null : a });
  const groups = useMemo(() => pointOptions(doc), [doc]);
  const shown = useSampled(meter.reading, DISPLAY_MS);
  const unit = UNIT[state.mode];
  const show = (v: number): string => {
    const si = formatSi(v, unit);
    return `${fmt(si.scaled, si.digits)} ${si.symbol}`;
  };

  // What the display shows: a value, OL, a dash, or a hint.
  let value: string = t('editor:meter.noReading');
  let minMax: string | null = null;
  let hint: string | null = meter.hint ? t(`editor:meter.hint.${meter.hint}`) : null;
  if (state.mode === 'ohm') {
    if (!meter.hint) {
      if (run === 'running') hint = t('editor:meter.hint.stopRun');
      else if (meter.ohmsPending) hint = t('editor:meter.hint.measuring');
      else if (meter.ohms) {
        const a = meter.ohms;
        if (a.ohms !== null) value = show(a.ohms);
        else if (a.reason === 'open') {
          value = t('editor:meter.ol');
          hint = t('editor:meter.hint.open');
        } else hint = t(`editor:meter.hint.${a.reason === 'unresolved' ? 'unresolved' : 'noRun'}`);
      }
    }
  } else if (!meter.hint) {
    if (run === 'none') hint = t('editor:meter.hint.noRun');
    else if (shown && Number.isFinite(shown.avg)) {
      value = show(shown.avg);
      // Each value is an LTR isolate, so "12.55 mA" stays whole inside a Persian sentence.
      minMax = t('editor:meter.minMax', { min: ltr(show(shown.min)), max: ltr(show(shown.max)) });
      if (state.mode === 'p' && shown.avg < 0) hint = t('editor:meter.hint.powerSign');
    } else if (shown) hint = t('editor:meter.hint.unresolved');
  }
  const current = state.current;
  const currentWire = current?.kind === 'wire' ? doc.wires.find((w) => w.id === current.wire) : undefined;
  const announced = useSampled(
    t('editor:meter.reading', { mode: t(`editor:meter.modes.${state.mode}`), value }),
    ANNOUNCE_MS,
  );

  const pointSelect = (
    label: string,
    value: PinRef | null,
    onChange: (r: PinRef | null) => void,
    none: string,
  ) => (
    <label className="flex min-w-0 flex-1 flex-col gap-0.5 text-xs text-ink-muted">
      {label}
      <select
        className="min-w-0 rounded border border-line bg-surface px-1 py-1 text-sm text-ink"
        value={encode(value)}
        onChange={(e) => onChange(e.target.value ? decode(e.target.value) : null)}
      >
        <option value="">{none}</option>
        {groups.map((g) => (
          <optgroup key={g.group} label={g.group}>
            {g.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
  const placeButton = (a: ProbeArm, label: string): ReactNode => (
    <Button
      variant="secondary"
      size="sm"
      aria-pressed={state.armed === a}
      onClick={() => arm(a)}
      className="shrink-0 self-end aria-pressed:ring-2 aria-pressed:ring-accent"
    >
      {label}
    </Button>
  );

  const place = {
    red: placeButton('red', t('editor:meter.place.red')),
    black: placeButton('black', t('editor:meter.place.black')),
    wire: placeButton('wire', t('editor:meter.place.wire')),
    part: placeButton('part', t('editor:meter.place.part')),
  };

  return (
    <section aria-label={t('editor:meter.title')} className="flex flex-col gap-2 text-sm">
      <SegmentedControl
        label={t('editor:meter.modes.label')}
        value={state.mode}
        options={MODES.map((m) => ({
          value: m,
          label: `${t(`editor:meter.modes.${m}`)} (${t(`editor:meter.units.${m}`)})`,
        }))}
        onChange={(mode) => set({ mode, armed: null })}
      />
      <div className="rounded-md border border-line bg-surface-raised px-3 py-2">
        <output
          data-testid="meter-value"
          dir="ltr"
          className="block font-mono text-2xl tabular-nums text-ink"
        >
          {value}
        </output>
        {minMax && (
          <p data-testid="meter-minmax" className="m-0 font-mono text-xs text-ink-muted">
            {minMax}
          </p>
        )}
        {hint && (
          <p data-testid="meter-hint" className="m-0 mt-1 text-xs text-ink-muted">
            {hint}
          </p>
        )}
        <p aria-live="polite" className="sr-only">
          {announced}
        </p>
      </div>
      {(state.mode === 'v' || state.mode === 'ohm') && (
        <>
          <div className="flex items-end gap-2">
            {pointSelect(
              t('editor:meter.probe.red'),
              state.red,
              (red) => set({ red }),
              t('editor:meter.probe.none'),
            )}
            {place.red}
          </div>
          <div className="flex items-end gap-2">
            {pointSelect(
              t('editor:meter.probe.black'),
              state.black,
              (black) => set({ black }),
              t('editor:meter.probe.gnd'),
            )}
            {place.black}
          </div>
        </>
      )}
      {state.mode === 'a' && (
        <div className="flex items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-0.5 text-xs text-ink-muted">
            {t('editor:meter.probe.current')}
            <select
              className="min-w-0 rounded border border-line bg-surface px-1 py-1 text-sm text-ink"
              value={
                state.current?.kind === 'wire'
                  ? `w:${state.current.wire}`
                  : state.current?.kind === 'pin'
                    ? `p:${encode(state.current.pin)}`
                    : ''
              }
              onChange={(e) => {
                const v = e.target.value;
                set({
                  current: v.startsWith('w:')
                    ? { kind: 'wire', wire: v.slice(2) }
                    : v.startsWith('p:')
                      ? { kind: 'pin', pin: decode(v.slice(2)) }
                      : null,
                });
              }}
            >
              <option value="">{t('editor:meter.probe.none')}</option>
              <optgroup label={t('editor:meter.probe.wires')}>
                {doc.wires.map((w) => (
                  <option key={w.id} value={`w:${w.id}`}>
                    {`${t('editor:meter.probe.wire', { id: w.id })}: ${w.from.part}.${w.from.pin} → ${w.to.part}.${w.to.pin}`}
                  </option>
                ))}
              </optgroup>
              {groups.map((g) => (
                <optgroup key={g.group} label={g.group}>
                  {g.options.map((o) => (
                    <option key={o.value} value={`p:${o.value}`}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          {place.wire}
        </div>
      )}
      {state.mode === 'a' && currentWire && (
        <p className="m-0 text-xs text-ink-muted">
          {t('editor:meter.hint.direction', {
            from: `${currentWire.from.part}.${currentWire.from.pin}`,
            to: `${currentWire.to.part}.${currentWire.to.pin}`,
          })}
        </p>
      )}
      {state.mode === 'p' && (
        <div className="flex items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-0.5 text-xs text-ink-muted">
            {t('editor:meter.probe.part')}
            <select
              className="min-w-0 rounded border border-line bg-surface px-1 py-1 text-sm text-ink"
              value={state.part ?? ''}
              onChange={(e) => set({ part: e.target.value || null })}
            >
              <option value="">{t('editor:meter.probe.none')}</option>
              {doc.components
                .filter((c) => !breadboardLayout(c.type))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id}
                  </option>
                ))}
            </select>
          </label>
          {place.part}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" size="sm" onClick={() => setState({ ...EMPTY_METER, mode: state.mode })}>
          {t('editor:meter.clear')}
        </Button>
        {onAddToScope !== undefined && (
          <Button
            variant="secondary"
            size="sm"
            disabled={!onAddToScope || !meter.probe}
            onClick={() => meter.probe && onAddToScope?.(meter.probe)}
          >
            {t('editor:meter.addToScope')}
          </Button>
        )}
      </div>
    </section>
  );
}
