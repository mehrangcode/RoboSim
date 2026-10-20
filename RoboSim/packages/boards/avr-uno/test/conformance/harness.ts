import type { Level, PinId } from '@robosim/sim-core';
import { AvrUnoCore, UNO_CLOCK_HZ } from '../../src/index.js';
import { CONFORMANCE_HEX } from './generated.js';
import type { ConformanceSketchId } from './sketches.js';

/** CPU cycles per microsecond at 16 MHz. */
export const US = UNO_CLOCK_HZ / 1e6;

export interface Edge {
  readonly level: Level;
  readonly cycle: number;
}

/** A conformance sketch on a bare Uno core, with every output edge and serial byte stamped by CPU cycle. */
export class Bench {
  readonly core: AvrUnoCore;
  readonly edges = new Map<PinId, Edge[]>();
  readonly serial: { cycle: number; byte: number }[] = [];

  constructor(id: ConformanceSketchId) {
    const hex = CONFORMANCE_HEX[id];
    this.core = AvrUnoCore.fromFirmware({
      format: 'ihex',
      bytes: Uint8Array.from(hex, (c) => c.charCodeAt(0)),
      sha256: id,
    });
    this.core.onPinEdge((pin, level, cycle) => {
      const list = this.edges.get(pin) ?? [];
      list.push({ level, cycle });
      this.edges.set(pin, list);
    });
    this.core.uart(0).onData((bytes) => {
      for (const byte of bytes) this.serial.push({ cycle: this.core.cycle, byte });
    });
  }

  /** Runs until `seconds` of simulated time since power-on. */
  runTo(seconds: number): this {
    this.core.run(Math.round(seconds * UNO_CLOCK_HZ));
    return this;
  }

  /** Drives an input pin from `seconds` on (volts also feed the ADC). */
  drive(pin: PinId, seconds: number, volts: number): this {
    this.core.scheduleInput(pin, { level: volts >= 2.5 ? 1 : 0, volts }, Math.round(seconds * UNO_CLOCK_HZ));
    return this;
  }

  /** A high pulse of `widthUs` starting at `seconds`. */
  pulse(pin: PinId, seconds: number, widthUs: number): this {
    return this.drive(pin, seconds, 5).drive(pin, seconds + widthUs / 1e6, 0);
  }

  text(): string {
    return String.fromCharCode(...this.serial.map((s) => s.byte));
  }

  lines(): string[] {
    return this.text()
      .split('\r\n')
      .filter((l) => l.length > 0);
  }

  pinEdges(pin: PinId, level?: Level, fromSeconds = 0): Edge[] {
    const from = fromSeconds * UNO_CLOCK_HZ;
    return (this.edges.get(pin) ?? []).filter(
      (e) => e.cycle >= from && (level === undefined || e.level === level),
    );
  }

  /** Cycles between consecutive edges. */
  gaps(pin: PinId, level?: Level, fromSeconds = 0): number[] {
    const e = this.pinEdges(pin, level, fromSeconds);
    return e.slice(1).map((x, i) => x.cycle - (e[i]?.cycle ?? 0));
  }

  /** High times (cycles) of complete pulses. */
  highTimes(pin: PinId, fromSeconds = 0): number[] {
    const e = this.pinEdges(pin, undefined, fromSeconds);
    const out: number[] = [];
    for (let i = 0; i + 1 < e.length; i++) {
      const [a, b] = [e[i], e[i + 1]];
      if (a?.level === 1 && b?.level === 0) out.push(b.cycle - a.cycle);
    }
    return out;
  }
}

/** Mean spacing of a run of periodic edges (first to last): exact on average, free of per-edge jitter. */
export function meanPeriod(edges: readonly Edge[]): number {
  const first = edges[0];
  const last = edges.at(-1);
  if (!first || !last || edges.length < 2) throw new Error('need at least two edges');
  return (last.cycle - first.cycle) / (edges.length - 1);
}
