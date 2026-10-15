import { SERIAL_TAIL_CHARS, type Frame } from '@robosim/sim-runtime/client';
import type { VerifiedRun } from './use-verified-run.js';

/** JSON with sorted keys: snapshot decoding may order object keys differently. */
function canonical(v: unknown): string {
  return JSON.stringify(v, (_, x: unknown) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : x,
  );
}

/**
 * Compares the verified run with the live run paused at the same slice: pins, robot pose, the
 * challenge and serial output must be bit-identical (FR-SIM-09).
 */
export function compareWithLive(
  run: VerifiedRun,
  frame: Frame | null,
  serial: string,
): 'identical' | 'differs' | 'moved' {
  if (!frame || frame.running || Math.round(frame.simTime * 1000) !== run.endSlice) return 'moved';
  const live = {
    pins: frame.pins,
    robot: frame.robot ? [frame.robot.x, frame.robot.y, frame.robot.angle] : null,
    challenge: frame.challenge
      ? [frame.challenge.status, frame.challenge.decidedAt, frame.challenge.score]
      : null,
    serial,
  };
  const verified = {
    pins: run.final.pins,
    robot: run.final.robot ?? null,
    challenge: run.challenge ? [run.challenge.status, run.challenge.decidedAt, run.challenge.score] : null,
    serial: run.serial.slice(-SERIAL_TAIL_CHARS),
  };
  return canonical(live) === canonical(verified) ? 'identical' : 'differs';
}
