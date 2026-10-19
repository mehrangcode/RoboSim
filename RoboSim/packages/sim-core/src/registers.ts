import type { MnaStamper, NetId } from './contracts.js';

/** A device's register space as seen through its bus (Tier C). */
export interface RegisterSpace {
  read(register: number, time: number): number;
  write(register: number, value: number, time: number): void;
}

/**
 * The register-pointer protocol most I²C sensors share (MPU-6050, BMP280, VL53L0X): the first byte
 * of a write sets the pointer, further bytes write registers, and reads continue from the pointer.
 * Both advance through `next` (by default +1, wrapping at 0xFF).
 */
export class RegisterPort {
  private pointer = 0;
  private expectPointer = false;

  constructor(
    private readonly space: RegisterSpace,
    private readonly next: (register: number) => number = (r) => (r + 1) & 0xff,
  ) {}

  /** Register the next access will use. */
  get register(): number {
    return this.pointer;
  }

  begin(read: boolean): void {
    this.expectPointer = !read;
  }

  write(byte: number, time: number): boolean {
    if (this.expectPointer) {
      this.pointer = byte & 0xff;
      this.expectPointer = false;
    } else {
      this.space.write(this.pointer, byte & 0xff, time);
      this.pointer = this.next(this.pointer);
    }
    return true;
  }

  read(time: number): number {
    const value = this.space.read(this.pointer, time) & 0xff;
    this.pointer = this.next(this.pointer);
    return value;
  }
}

/**
 * Pull-up resistor of a breakout board's bus line (Tier C): to another net (the module's VCC) or to a
 * fixed voltage (its onboard 3.3 V regulator, as a Norton source while the module is powered).
 */
export function stampPullUp(
  s: MnaStamper,
  net: NetId,
  gnd: NetId,
  ohms: number,
  to: { readonly net: NetId } | { readonly volts: number },
): void {
  if ('net' in to) {
    s.conductance(net, to.net, 1 / ohms);
    return;
  }
  s.conductance(net, gnd, 1 / ohms);
  s.currentSource(gnd, net, to.volts / ohms);
}
