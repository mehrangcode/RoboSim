import { useCallback, useEffect, useRef, useState } from 'react';

const KEY = 'robosim.audio.v1';
/** Master level: buzzers are loud; keep the browser output comfortable. */
const MASTER_GAIN = 0.05;
const RAMP_S = 0.01;

interface Voice {
  readonly osc: OscillatorNode;
  readonly gain: GainNode;
}

/** A part's live state as far as sound goes (active and passive buzzers). */
function toneOf(state: unknown): { hz: number; level: number } | null {
  const s = state as { sounding?: unknown; toneHz?: unknown; loudness?: unknown } | null | undefined;
  if (s?.sounding !== true || typeof s.toneHz !== 'number' || s.toneHz <= 0) return null;
  return { hz: s.toneHz, level: typeof s.loudness === 'number' ? s.loudness : 1 };
}

function loadEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on';
  } catch {
    return false;
  }
}

/**
 * Plays every sounding buzzer of the live frame as a square wave at its tone (FR-SIM-06 outputs):
 * one oscillator per part, silenced when the part stops, the run pauses, or sound is switched off.
 * Off by default; the AudioContext is created from the user's click on the toggle (autoplay policy).
 */
export function useBuzzerAudio(
  parts: Readonly<Record<string, unknown>> | undefined,
  running: boolean,
): { enabled: boolean; toggle: () => void } {
  const [enabled, setEnabled] = useState(loadEnabled);
  const ctx = useRef<AudioContext | null>(null);
  const voices = useRef(new Map<string, Voice>());

  const toggle = useCallback(() => {
    setEnabled((on) => {
      const next = !on;
      try {
        localStorage.setItem(KEY, next ? 'on' : 'off');
      } catch {
        // Not persisted; the choice still applies for this visit.
      }
      if (next && !ctx.current && typeof AudioContext !== 'undefined') ctx.current = new AudioContext();
      void ctx.current?.resume();
      return next;
    });
  }, []);

  useEffect(() => {
    // Sound left on from an earlier visit: the page has had a click (Run) by the time frames arrive.
    if (enabled && running && !ctx.current && typeof AudioContext !== 'undefined')
      ctx.current = new AudioContext();
    const audio = ctx.current;
    if (!audio) return;
    const now = audio.currentTime;
    const wanted = new Map<string, { hz: number; level: number }>();
    if (enabled && running && parts)
      for (const [id, state] of Object.entries(parts)) {
        const tone = toneOf(state);
        if (tone) wanted.set(id, tone);
      }
    for (const [id, v] of voices.current) {
      if (wanted.has(id)) continue;
      v.gain.gain.setTargetAtTime(0, now, RAMP_S);
      v.osc.stop(now + RAMP_S * 5);
      voices.current.delete(id);
    }
    for (const [id, { hz, level }] of wanted) {
      let v = voices.current.get(id);
      if (!v) {
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.type = 'square';
        gain.gain.value = 0;
        osc.connect(gain).connect(audio.destination);
        osc.start();
        v = { osc, gain };
        voices.current.set(id, v);
      }
      v.osc.frequency.setTargetAtTime(hz, now, RAMP_S);
      v.gain.gain.setTargetAtTime(MASTER_GAIN * level, now, RAMP_S);
    }
  }, [parts, running, enabled]);

  useEffect(
    () => () => {
      for (const v of voices.current.values()) v.osc.stop();
      voices.current.clear();
      void ctx.current?.close();
      ctx.current = null;
    },
    [],
  );

  return { enabled, toggle };
}
