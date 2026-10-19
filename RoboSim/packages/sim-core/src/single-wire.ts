import type { ComponentIO, Level, NetId, PinMode } from './contracts.js';

/** What the firmware just did to an open-drain line: pulled it low, or let go after `lowFor` seconds. */
export type LineEvent =
  | { readonly kind: 'fall'; readonly time: number }
  | { readonly kind: 'release'; readonly time: number; readonly lowFor: number };

/**
 * Follows an MCU pin on a single-wire bus (catalogue Tier C: DHT11, 1-Wire) from `mcuEdge` and
 * `mcuMode`: the pin pulls the line low while it is an output at LOW, and releases it when it turns
 * into an input or drives HIGH. Libraries do both (`pinMode(OUTPUT)` with the port bit already low,
 * `DIRECT_MODE_INPUT`), so neither alone shows every slot.
 */
export class OpenDrainWatch {
  private lowSince: number | null = null;

  edge(level: Level, time: number): LineEvent | null {
    return this.drive(level === 0, time);
  }

  mode(mode: PinMode, level: Level, time: number): LineEvent | null {
    return this.drive(mode === 'output' && level === 0, time);
  }

  /** The firmware is holding the line low now. */
  get low(): boolean {
    return this.lowSince !== null;
  }

  private drive(low: boolean, time: number): LineEvent | null {
    if (low && this.lowSince === null) {
      this.lowSince = time;
      return { kind: 'fall', time };
    }
    if (!low && this.lowSince !== null) {
      const lowFor = time - this.lowSince;
      this.lowSince = null;
      return { kind: 'release', time, lowFor };
    }
    return null;
  }
}

/**
 * A part pulls the line low from `from` to `to` (seconds), as the MCU sees it. Afterwards the input
 * returns to what the circuit gives without the part (the pull-up, or nothing if there is none).
 */
export function pullLow(io: ComponentIO, net: NetId, from: number, to: number, vih: number): void {
  io.scheduleMcuInput(net, 0, from);
  io.scheduleMcuInput(net, io.solution.voltage(net) >= vih ? 1 : 0, to);
}
