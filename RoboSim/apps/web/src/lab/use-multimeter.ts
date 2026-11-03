import {
  CircuitNets,
  electricalPoint,
  wireCut,
  type CanvasProbe,
  type ProbeArm,
  type ProbeTarget,
} from '@robosim/circuit-canvas';
import type {
  MeasureChannel,
  MeasureProbe,
  OhmsAnswer,
  PointRef,
  ProbeReading,
} from '@robosim/sim-runtime/client';
import { BOARD_PART, type PinRef, type ProjectDocument } from '@robosim/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatSi, useFormat, type SiUnit } from './format.js';

export type MeterMode = 'v' | 'a' | 'ohm' | 'p';
export const MODES: readonly MeterMode[] = ['v', 'a', 'ohm', 'p'];
export const UNIT: Readonly<Record<MeterMode, SiUnit>> = { v: 'V', a: 'A', ohm: 'Ω', p: 'W' };
/** Display refresh (US-SIM-09 AC1: ≈10 Hz) and the screen-reader announcement rate (1 Hz). */
export const DISPLAY_MS = 100;
export const ANNOUNCE_MS = 1000;
const BOARD_GROUND = new Set(['GND1', 'GND2', 'GND3']);

/** What the meter is connected to. Session only: probes are not saved with the project. */
export interface MeterState {
  readonly mode: MeterMode;
  readonly red: PinRef | null;
  /** Null: COM on GND. */
  readonly black: PinRef | null;
  /** A mode: current through a wire, or into a part through one pin. */
  readonly current:
    { readonly kind: 'wire'; readonly wire: string } | { readonly kind: 'pin'; readonly pin: PinRef } | null;
  /** P mode: the part. */
  readonly part: string | null;
  readonly armed: ProbeArm | null;
}

export const EMPTY_METER: MeterState = {
  mode: 'v',
  red: null,
  black: null,
  current: null,
  part: null,
  armed: null,
};

/** Hint keys under `editor:meter.hint`. */
type Hint =
  | 'placeRed'
  | 'pickCurrent'
  | 'pickPart'
  | 'floating'
  | 'loop'
  | 'hole'
  | 'ground'
  | 'noRun'
  | 'stopRun'
  | 'open'
  | 'unresolved'
  | 'measuring';

/** The probe the worker reads for this state, or why there is none (main-thread resolution, TD §18.2). */
export function meterProbe(
  doc: ProjectDocument,
  nets: CircuitNets,
  s: MeterState,
): { probe: MeasureProbe | null; points?: { red: PointRef; black: PointRef | null }; hint: Hint | null } {
  const isHole = (r: PinRef) => electricalPoint(doc, nets, r) !== r;
  if (s.mode === 'v' || s.mode === 'ohm') {
    if (!s.red) return { probe: null, hint: 'placeRed' };
    const red = electricalPoint(doc, nets, s.red);
    const black = s.black ? electricalPoint(doc, nets, s.black) : null;
    if (!red || (s.black && !black)) return { probe: null, hint: 'floating' };
    const points = { red, black };
    return s.mode === 'v'
      ? { probe: { kind: 'v', red, black }, points, hint: null }
      : { probe: null, points, hint: null };
  }
  if (s.mode === 'p')
    return s.part ? { probe: { kind: 'p', part: s.part }, hint: null } : { probe: null, hint: 'pickPart' };
  const c = s.current;
  if (!c) return { probe: null, hint: 'pickCurrent' };
  if (c.kind === 'pin') {
    if (isHole(c.pin)) return { probe: null, hint: 'hole' };
    if (c.pin.part === BOARD_PART && BOARD_GROUND.has(c.pin.pin)) return { probe: null, hint: 'ground' };
    return { probe: { kind: 'i', pins: [c.pin], scale: 1 }, hint: null };
  }
  const cut = wireCut(doc, c.wire);
  if (!cut) return { probe: null, hint: 'pickCurrent' };
  if (cut.kind === 'loop') return { probe: null, hint: 'loop' };
  if (cut.kind === 'floating') return { probe: null, hint: 'floating' };
  return { probe: { kind: 'i', pins: cut.side, scale: cut.scale }, hint: null };
}

/** The latest value, re-read at most every `ms` (a meter display does not flicker at 30 Hz). */
export function useSampled<T>(value: T, ms: number): T {
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  });
  const [shown, setShown] = useState(value);
  useEffect(() => {
    const id = setInterval(() => setShown(() => latest.current), ms);
    return () => clearInterval(id);
  }, [ms]);
  return shown;
}

export interface MultimeterSim {
  measure(channel: MeasureChannel, probes: readonly MeasureProbe[] | null): void;
  ohms(red: PointRef, black: PointRef | null, project?: ProjectDocument): Promise<OhmsAnswer>;
  readonly meterReadings: readonly ProbeReading[] | null;
}

/**
 * Virtual multimeter state and wiring (FR-SIM-13): subscribes the worker's meter channel while the
 * panel is shown, asks for Ω on demand, and hands the canvas its probe markers and armed clicks.
 * `run`: no run loaded / paused / running.
 */
export function useMultimeter({
  doc,
  sim,
  active,
  run,
}: {
  doc: ProjectDocument;
  sim: MultimeterSim;
  active: boolean;
  run: 'none' | 'paused' | 'running';
}) {
  const [state, setState] = useState<MeterState>(EMPTY_METER);
  const nets = useMemo(() => new CircuitNets(doc), [doc]);
  const resolved = useMemo(() => meterProbe(doc, nets, state), [doc, nets, state]);
  const { measure } = sim;

  // Subscribe the meter channel to the probe while the panel is shown (view-only, ADR-026).
  const probeKey = active && resolved.probe ? JSON.stringify(resolved.probe) : '';
  useEffect(() => {
    if (!probeKey) return;
    measure('meter', [JSON.parse(probeKey) as MeasureProbe]);
    return () => measure('meter', null);
  }, [probeKey, measure]);

  // Ω: refused while running; else measured once per (points, run state, circuit). An answer is kept
  // with the key it answers, so a newer request shows as pending until its own answer arrives.
  const [ohms, setOhms] = useState<{ key: string; answer: OhmsAnswer } | null>(null);
  const points = resolved.points;
  const ohmsKey =
    active && state.mode === 'ohm' && points && run !== 'running'
      ? JSON.stringify([points, run, run === 'none' ? [doc.components, doc.wires] : null])
      : '';
  const { ohms: askOhms } = sim;
  useEffect(() => {
    if (!ohmsKey || !points) return;
    let live = true;
    void askOhms(points.red, points.black, run === 'none' ? doc : undefined).then(
      (answer) => live && setOhms({ key: ohmsKey, answer }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ohmsKey captures points, run and the circuit
  }, [ohmsKey, askOhms]);

  const pick = (target: ProbeTarget) =>
    setState((s) => {
      const armed = s.armed;
      if (armed === 'red' || armed === 'black')
        return target.kind === 'pin' ? { ...s, [armed]: target.pin, armed: null } : s;
      if (armed === 'wire')
        return target.kind === 'part'
          ? s
          : {
              ...s,
              current: target.kind === 'wire' ? target : { kind: 'pin', pin: target.pin },
              armed: null,
            };
      if (armed === 'part')
        return {
          ...s,
          part: target.kind === 'part' ? target.part : target.kind === 'pin' ? target.pin.part : s.part,
          armed: null,
        };
      return s;
    });

  // Live readings only belong to a loaded run; batches of an earlier run are never shown.
  const reading = state.mode === 'ohm' || run === 'none' ? null : (sim.meterReadings?.[0] ?? null);
  const wireLabel = useWireLabel(state, reading);
  const canvasProbe: CanvasProbe | null = active
    ? {
        armed: state.armed,
        onPick: pick,
        onCancel: () => setState((s) => ({ ...s, armed: null })),
        markers:
          state.mode === 'v' || state.mode === 'ohm'
            ? { red: state.red, black: state.black ?? { part: BOARD_PART, pin: 'GND1' } }
            : state.mode === 'p'
              ? { part: state.part }
              : state.current?.kind === 'pin'
                ? { red: state.current.pin }
                : state.current?.kind === 'wire'
                  ? { wire: { id: state.current.wire, label: wireLabel, reversed: (reading?.avg ?? 0) < 0 } }
                  : {},
      }
    : null;

  return {
    state,
    setState,
    canvasProbe,
    hint: resolved.hint,
    reading,
    ohms: ohmsKey && ohms?.key === ohmsKey ? ohms.answer : null,
    ohmsPending: ohmsKey !== '' && ohms?.key !== ohmsKey,
    run,
  };
}

function useWireLabel(state: MeterState, reading: ProbeReading | null): string {
  const fmt = useFormat();
  if (state.mode !== 'a' || !reading || !Number.isFinite(reading.avg)) return '';
  const v = formatSi(Math.abs(reading.avg), 'A');
  return `${fmt(v.scaled, v.digits)} ${v.symbol}`;
}

export type MultimeterModel = ReturnType<typeof useMultimeter>;
