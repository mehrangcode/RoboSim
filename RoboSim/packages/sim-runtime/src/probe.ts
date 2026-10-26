import type { Level, McuCore, Unsubscribe } from '@robosim/sim-core';

/** The logic analyzer records at most this many pins at once (FR-SIM-08). */
export const MAX_PROBE_PINS = 8;
/** A capture stops when it holds this many edges (about 4 MB of samples in the UI). */
export const MAX_PROBE_EDGES = 500_000;

/**
 * Records level changes of selected MCU pins with their CPU cycle (FR-SIM-08): output edges from
 * the core (`digitalWrite`, timer PWM, software pulses) and driven inputs (`onPinInput`). It only
 * observes, so a capture never changes the run and is not part of the input log.
 */
export class PinRecorder {
  readonly levels: Level[];
  /** Edges since the last {@link drain}, as `[pinIndex, level, cycle]` triples. */
  private pending: number[] = [];
  private total = 0;
  private full = false;
  private readonly offs: Unsubscribe[] = [];

  constructor(
    mcu: McuCore,
    readonly pins: readonly string[],
    initial: readonly Level[],
  ) {
    this.levels = [...initial];
    const index = new Map(pins.map((p, i) => [p, i]));
    const record = (pin: string, level: Level, cycle: number) => {
      const i = index.get(pin);
      if (i === undefined || this.full || this.levels[i] === level) return;
      this.levels[i] = level;
      this.pending.push(i, level, cycle);
      if (++this.total >= MAX_PROBE_EDGES) {
        this.full = true;
        this.stop();
      }
    };
    this.offs.push(mcu.onPinEdge(record));
    if (mcu.onPinInput) this.offs.push(mcu.onPinInput(record));
  }

  /** True once the capture reached {@link MAX_PROBE_EDGES} and stopped recording. */
  get isFull(): boolean {
    return this.full;
  }

  drain(): Float64Array {
    const out = Float64Array.from(this.pending);
    this.pending = [];
    return out;
  }

  stop(): void {
    for (const off of this.offs.splice(0)) off();
  }
}
