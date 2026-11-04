import { defaultDuty, staticBudget, type Budget, type BudgetSource } from '@robosim/circuit-canvas';
import { batteryLife, type BatteryLife, type EnergyView } from '@robosim/sim-runtime/client';
import { BOARD_PART, type ProjectDocument } from '@robosim/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormat } from './format.js';

export const POWER_SETTINGS_KEY = 'robosim.power.v1';

/** Run part ids of the board's supply pins (the project loader's rails) ↔ document supply keys. */
export const RAIL_PARTS: Readonly<Record<string, string>> = {
  '5V-rail': `${BOARD_PART}.5V`,
  '3V3-rail': `${BOARD_PART}.3V3`,
};
/** The supply key of a run source (`5V-rail.pos` → `board.5V`). */
export const sourceKey = (id: string, pin: string): string => RAIL_PARTS[id] ?? `${id}.${pin}`;

export interface PowerSettings {
  /** Record the power budget on every run, not only while the panel is open. */
  readonly recordAll: boolean;
  /** Duty 0..1 per part id, per project. */
  readonly duty: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

const EMPTY: PowerSettings = { recordAll: false, duty: {} };

function load(): PowerSettings {
  try {
    const raw = JSON.parse(
      localStorage.getItem(POWER_SETTINGS_KEY) ?? 'null',
    ) as Partial<PowerSettings> | null;
    if (!raw || typeof raw !== 'object') return EMPTY;
    const duty: Record<string, Record<string, number>> = {};
    for (const [project, parts] of Object.entries(raw.duty ?? {})) {
      if (!parts || typeof parts !== 'object') continue;
      duty[project] = Object.fromEntries(
        Object.entries(parts).filter(([, v]) => typeof v === 'number' && v >= 0 && v <= 1),
      );
    }
    return { recordAll: raw.recordAll === true, duty };
  } catch {
    return EMPTY;
  }
}

function save(s: PowerSettings): void {
  try {
    localStorage.setItem(POWER_SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // Storage full or blocked: the settings last for this session.
  }
}

/** Life of one battery: static from typical draws, measured from the run's currents. */
export interface BatteryCard {
  readonly key: string;
  readonly part: string;
  readonly life: BatteryLife;
  readonly cutoffV: number;
  readonly avgMa: number;
}

/** Battery life from a supply node and the current drawn from it (TD §18.4). */
export function batteryCard(
  s: BudgetSource,
  draw: { avgMa: number; p90Ma: number; peakMa: number; charge?: number },
): BatteryCard | null {
  if (!s.battery) return null;
  const cutoffV = s.cutoffV ?? 0;
  return {
    key: s.key,
    part: s.part,
    cutoffV,
    avgMa: draw.avgMa,
    life: batteryLife({
      cells: s.battery.cells,
      capacityMah: s.battery.capacityMah,
      internalOhms: s.battery.internalOhms,
      charge: draw.charge ?? s.battery.charge,
      cutoffV,
      avgMa: draw.avgMa,
      p90Ma: draw.p90Ma,
      peakMa: draw.peakMa,
    }),
  };
}

export interface PowerModel {
  readonly budget: Budget;
  readonly energy: EnergyView | null;
  /** Duty per part id (stored values only; parts without one use {@link defaultDuty}). */
  readonly duty: Readonly<Record<string, number>>;
  setDuty(partId: string, duty: number | null): void;
  readonly recordAll: boolean;
  setRecordAll(on: boolean): void;
  /** Battery cards: static from typical draws, measured once the run has reported. */
  readonly batteries: { readonly static: readonly BatteryCard[]; readonly measured: readonly BatteryCard[] };
}

/**
 * Power budget panel state (FR-SIM-15, TD §18.4). The worker records while the panel is shown or "record
 * every run" is set (the meter costs a few % of slice time); the static budget follows the document.
 */
export function usePower({
  doc,
  sim,
  active,
  projectKey,
}: {
  doc: ProjectDocument;
  sim: { energy: EnergyView | null; energyOn(on: boolean): void };
  active: boolean;
  projectKey: string;
}): PowerModel {
  const [settings, setSettings] = useState(load);
  const update = useCallback((f: (s: PowerSettings) => PowerSettings) => {
    setSettings((s) => {
      const next = f(s);
      save(next);
      return next;
    });
  }, []);
  const recording = active || settings.recordAll;
  const { energyOn } = sim;
  useEffect(() => energyOn(recording), [energyOn, recording]);

  const duty = useMemo(() => settings.duty[projectKey] ?? {}, [settings.duty, projectKey]);
  const budget = useMemo(() => staticBudget(doc, duty), [doc, duty]);
  const energy = sim.energy;

  const batteries = useMemo(() => {
    const roots = budget.sources.filter((s) => s.battery);
    const statics = roots.flatMap((s) => {
      const c = batteryCard(s, { avgMa: s.typMa, p90Ma: s.peakMa, peakMa: s.peakMa });
      return c ? [c] : [];
    });
    const measured = !energy
      ? []
      : roots.flatMap((s) => {
          const m = energy.sources.find((x) => sourceKey(x.id, x.pin) === s.key);
          const c = m
            ? batteryCard(s, {
                avgMa: m.avgMa,
                p90Ma: m.p90Ma,
                peakMa: m.peakMa,
                ...(m.charge !== undefined ? { charge: m.charge } : {}),
              })
            : null;
          return c ? [c] : [];
        });
    return { static: statics, measured };
  }, [budget, energy]);

  return {
    budget,
    energy,
    duty,
    setDuty: (partId, value) =>
      update((s) => {
        const type = doc.components.find((c) => c.id === partId)?.type ?? '';
        const others = Object.entries(s.duty[projectKey] ?? {}).filter(([id]) => id !== partId);
        const mine = Object.fromEntries(
          value === null || value === defaultDuty(type)
            ? others
            : [...others, [partId, Math.min(1, Math.max(0, value))]],
        );
        return { ...s, duty: { ...s.duty, [projectKey]: mine } };
      }),
    recordAll: settings.recordAll,
    setRecordAll: (on) => update((s) => ({ ...s, recordAll: on })),
    batteries,
  };
}

/** Hours as "3 h 10 min" (or "45 min") in the UI language. */
export function useDuration() {
  const { t } = useTranslation();
  const fmt = useFormat();
  return (hours: number): string => {
    const total = Math.round(hours * 60);
    const h = Math.floor(total / 60);
    const m = total % 60;
    if (h === 0) return t('editor:power.duration.min', { m: fmt(m) });
    return t('editor:power.duration.hMin', { h: fmt(h), m: fmt(m) });
  };
}
