import { CircuitNets, electricalPoint, type CanvasProbe } from '@robosim/circuit-canvas';
import {
  MAX_SCOPE_CHANNELS,
  type MeasureChannel,
  type MeasureProbe,
  type PointRef,
  type ScopeBuffer,
} from '@robosim/sim-runtime/client';
import { BOARD_PART, type ProjectDocument } from '@robosim/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SiUnit } from './format.js';
import type { Edge, TriggerMode } from './scope-math.js';

export const SCOPE_SETTINGS_KEY = 'robosim.scope.v1';
/** Fine mode (TD §18.3) runs while the timebase is below this (s/div) and a voltage channel is shown. */
export const FINE_TIMEBASE = 0.001;
/** Fine mode turns itself off when the run stays below this share of the chosen speed… */
export const FINE_MIN_RTF = 0.8;
/** …for this long (ms), so a single slow frame does not. */
export const FINE_SLOW_MS = 2000;
/**
 * Fine mode: `off` (timebase ≥ 1 ms/div or no voltage channel), `on`, `none` (on, but the circuit has
 * no capacitor or inductor, so no sub-steps), `slow` (turned off: the run fell below 0.8× real time).
 */
export type FineState = 'off' | 'on' | 'none' | 'slow';
/** Timebases (s/div) and per-division scales offered; the screen is 10 × 8 divisions. */
export const DIVS_X = 10;
export const DIVS_Y = 8;

export interface ScopeChannel {
  readonly probe: MeasureProbe;
  /** Units per division. */
  readonly scale: number;
  /** Vertical position of 0 in divisions from the centre (+ up). */
  readonly offset: number;
}

export interface ScopeTrigger {
  /** Channel index, or null (free-running). */
  readonly ch: number | null;
  readonly edge: Edge;
  readonly level: number;
  readonly mode: TriggerMode;
  readonly holdoffS: number;
}

export interface ScopeSettings {
  readonly channels: readonly ScopeChannel[];
  /** Seconds per division. */
  readonly timebase: number;
  readonly trigger: ScopeTrigger;
}

export const DEFAULT_SCOPE: ScopeSettings = {
  channels: [],
  timebase: 0.1,
  trigger: { ch: 0, edge: 'rising', level: 2.5, mode: 'auto', holdoffS: 0 },
};

export const unitOf = (p: MeasureProbe): SiUnit => (p.kind === 'v' ? 'V' : p.kind === 'i' ? 'A' : 'W');
/** A default scale: 1 V/div shows 0…5 V logic; 10 mA/div an LED; 100 mW/div a small load. */
const defaultScale = (p: MeasureProbe) => (p.kind === 'v' ? 1 : p.kind === 'i' ? 0.01 : 0.1);

const point = (r: PointRef) => (r.part === BOARD_PART ? r.pin : `${r.part}.${r.pin}`);
/** What a channel measures, in document ids (language neutral: pin names stay as printed). */
export function probeLabel(p: MeasureProbe): string {
  if (p.kind === 'v') return p.black ? `${point(p.red)} − ${point(p.black)}` : point(p.red);
  if (p.kind === 'i') return p.pins.map(point).join(' + ');
  return p.part;
}

/** True when a probe names a part that is no longer in the document (the channel shows "—"). */
export function probeGone(doc: ProjectDocument, p: MeasureProbe): boolean {
  const ids = new Set(doc.components.map((c) => c.id));
  const refs = p.kind === 'v' ? [p.red, ...(p.black ? [p.black] : [])] : p.kind === 'i' ? p.pins : [];
  const parts = p.kind === 'p' ? [p.part] : refs.map((r) => r.part);
  return parts.some((id) => id !== BOARD_PART && !ids.has(id));
}

const isRef = (r: unknown): r is PointRef =>
  typeof r === 'object' &&
  r !== null &&
  typeof (r as PointRef).part === 'string' &&
  typeof (r as PointRef).pin === 'string';
function isProbe(p: unknown): p is MeasureProbe {
  const x = p as Partial<Record<string, unknown>> | null;
  if (!x || typeof x !== 'object') return false;
  if (x['kind'] === 'v') return isRef(x['red']) && (x['black'] === null || isRef(x['black']));
  if (x['kind'] === 'i')
    return Array.isArray(x['pins']) && x['pins'].every(isRef) && (x['scale'] === 1 || x['scale'] === -1);
  return x['kind'] === 'p' && typeof x['part'] === 'string';
}
const finite = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** Settings from storage, keeping only well-formed parts (unreadable storage: the defaults). */
export function loadScopeSettings(): ScopeSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(SCOPE_SETTINGS_KEY) ?? 'null') as Partial<
      Record<keyof ScopeSettings, unknown>
    > | null;
    if (!raw) return DEFAULT_SCOPE;
    const channels = (Array.isArray(raw.channels) ? raw.channels : [])
      .filter((c: unknown): c is ScopeChannel => isProbe((c as ScopeChannel | null)?.probe))
      .slice(0, MAX_SCOPE_CHANNELS)
      .map((c) => ({
        probe: c.probe,
        scale: finite(c.scale, defaultScale(c.probe)),
        offset: finite(c.offset, 0),
      }));
    const t = (raw.trigger ?? {}) as Partial<ScopeTrigger>;
    const d = DEFAULT_SCOPE.trigger;
    return {
      channels,
      timebase: finite(raw.timebase, DEFAULT_SCOPE.timebase),
      trigger: {
        ch: t.ch === null ? null : Math.min(Math.max(0, finite(t.ch, 0)), MAX_SCOPE_CHANNELS - 1),
        edge: t.edge === 'falling' ? 'falling' : 'rising',
        level: finite(t.level, d.level),
        mode: t.mode === 'normal' || t.mode === 'single' ? t.mode : 'auto',
        holdoffS: Math.max(0, finite(t.holdoffS, 0)),
      },
    };
  } catch {
    return DEFAULT_SCOPE;
  }
}

function saveScopeSettings(s: ScopeSettings): void {
  try {
    localStorage.setItem(SCOPE_SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // The settings last for the session.
  }
}

export interface ScopeSim {
  measure(channel: MeasureChannel, probes: readonly MeasureProbe[] | null): void;
  scopeFine(on: boolean): void;
  readonly frame: { readonly running: boolean; readonly rtf: number } | null;
  readonly scope: ScopeBuffer | null;
  readonly scopeVersion: number;
}

/**
 * Oscilloscope state and wiring (FR-SIM-14): keeps the worker's scope channel subscribed while it has
 * channels — also with its tab closed, so switching tabs keeps the history (≤ 10 µs per slice) — and
 * arms a canvas click to add a voltage channel on a pin. View-only (ADR-026).
 */
export function useScope({
  doc,
  sim,
  active,
  speed = 1,
}: {
  doc: ProjectDocument;
  sim: ScopeSim;
  active: boolean;
  /** Chosen simulation speed (× real time): fine mode compares the run's RTF with it. */
  speed?: number;
}) {
  const [settings, setSettingsState] = useState<ScopeSettings>(loadScopeSettings);
  const [armed, setArmed] = useState(false);
  const nets = useMemo(() => new CircuitNets(doc), [doc]);
  const setSettings = (update: (s: ScopeSettings) => ScopeSettings) =>
    setSettingsState((s) => {
      const next = update(s);
      saveScopeSettings(next);
      return next;
    });

  const { measure } = sim;
  const probesKey = JSON.stringify(settings.channels.map((c) => c.probe));
  useEffect(() => {
    const probes = JSON.parse(probesKey) as MeasureProbe[];
    if (!probes.length) return;
    measure('scope', probes);
    return () => measure('scope', null);
  }, [probesKey, measure]);

  // Fine mode (TD §18.3 phase 2): sub-steps of reactive circuits below 1 ms/div; off again if it slows
  // the run below 0.8× the chosen speed for 2 s (it costs ≤ 15 % on its own, but a slow PC has no slack).
  const wantsFine =
    settings.timebase < FINE_TIMEBASE - 1e-12 && settings.channels.some((c) => c.probe.kind === 'v');
  const [slow, setSlow] = useState(false);
  const fineOn = wantsFine && !slow;
  const { scopeFine } = sim;
  useEffect(() => {
    if (!fineOn) return;
    scopeFine(true);
    return () => scopeFine(false);
  }, [fineOn, scopeFine]);
  // Leaving the fine timebases forgets the auto-off, so coming back tries fine mode again.
  if (!wantsFine && slow) setSlow(false);
  const slowSince = useRef<number | null>(null);
  const rtf = sim.frame?.running ? sim.frame.rtf : null;
  useEffect(() => {
    if (!fineOn || rtf === null || rtf <= 0 || rtf >= FINE_MIN_RTF * speed) {
      slowSince.current = null;
      return;
    }
    const now = performance.now();
    slowSince.current ??= now;
    if (now - slowSince.current >= FINE_SLOW_MS) setSlow(true);
  }, [fineOn, rtf, speed]);

  const full = settings.channels.length >= MAX_SCOPE_CHANNELS;
  const add = (probe: MeasureProbe) =>
    setSettings((s) =>
      s.channels.length >= MAX_SCOPE_CHANNELS ||
      s.channels.some((c) => JSON.stringify(c.probe) === JSON.stringify(probe))
        ? s
        : { ...s, channels: [...s.channels, { probe, scale: defaultScale(probe), offset: 0 }] },
    );
  const remove = (i: number) =>
    setSettings((s) => {
      const channels = s.channels.filter((_, k) => k !== i);
      const ch = s.trigger.ch;
      return {
        ...s,
        channels,
        trigger: {
          ...s.trigger,
          ch: ch === null || ch < i ? ch : ch === i ? (channels.length ? 0 : null) : ch - 1,
        },
      };
    });
  const updateChannel = (i: number, patch: Partial<Omit<ScopeChannel, 'probe'>>) =>
    setSettings((s) => ({ ...s, channels: s.channels.map((c, k) => (k === i ? { ...c, ...patch } : c)) }));

  const canvasProbe: CanvasProbe | null =
    active && armed
      ? {
          armed: 'red',
          onPick: (target) => {
            if (target.kind !== 'pin') return;
            const red = electricalPoint(doc, nets, target.pin);
            if (red) add({ kind: 'v', red, black: null });
            setArmed(false);
          },
          onCancel: () => setArmed(false),
          markers: {},
        }
      : null;

  // Only a buffer of the current subscription belongs to these channels.
  const buffer = sim.scope && sim.scope.channels === settings.channels.length ? sim.scope : null;
  const fine: FineState = !wantsFine ? 'off' : slow ? 'slow' : buffer?.reactive === false ? 'none' : 'on';
  return {
    settings,
    setSettings,
    add,
    remove,
    updateChannel,
    full,
    armed: active && armed,
    setArmed,
    canvasProbe,
    buffer,
    version: sim.scopeVersion,
    gone: settings.channels.map((c) => probeGone(doc, c.probe)),
    fine,
    /** Turns fine mode on again after it was turned off for being slow. */
    retryFine: () => {
      slowSince.current = null;
      setSlow(false);
    },
  };
}

export type ScopeModel = ReturnType<typeof useScope>;
