import type { ProbeStart } from './protocol.js';

/** Edges of one pin in a capture, oldest first (parallel arrays). */
export interface PinTrace {
  readonly pin: string;
  /** Level at the start of the capture. */
  readonly initial: 0 | 1;
  readonly cycles: number[];
  readonly levels: (0 | 1)[];
}

/**
 * A logic-analyzer capture as the UI sees it (FR-SIM-08): per-pin edges with CPU-cycle stamps,
 * folded from the worker's `edges` messages. `version` changes on every append.
 */
export class PinCapture {
  readonly traces: readonly PinTrace[];
  readonly startCycle: number;
  readonly clockHz: number;
  /** Last cycle the capture covers. */
  until: number;
  /** Recording stopped at the edge limit. */
  full = false;
  /** Recording was stopped by the user; `until` no longer advances. */
  stopped = false;
  version = 0;

  constructor(
    readonly id: number,
    start: ProbeStart,
  ) {
    this.startCycle = start.cycle;
    this.clockHz = start.clockHz;
    this.until = start.cycle;
    this.traces = start.pins.map((pin, i) => ({
      pin,
      initial: start.levels[i] ?? 0,
      cycles: [],
      levels: [],
    }));
  }

  append(data: Float64Array, until: number, full: boolean): void {
    for (let i = 0; i + 2 < data.length; i += 3) {
      const trace = this.traces[data[i] ?? -1];
      if (!trace) continue;
      trace.cycles.push(data[i + 2] ?? 0);
      trace.levels.push(data[i + 1] === 1 ? 1 : 0);
    }
    this.until = Math.max(this.until, until);
    if (full) this.full = true;
    this.version++;
  }

  /** Seconds from the start of the capture to `cycle`. */
  seconds(cycle: number): number {
    return (cycle - this.startCycle) / this.clockHz;
  }

  get edgeCount(): number {
    return this.traces.reduce((n, t) => n + t.cycles.length, 0);
  }
}
