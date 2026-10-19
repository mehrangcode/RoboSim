import { describe, expect, it } from 'vitest';
import type { I2cBusHandler } from '@robosim/sim-core';
import type { AvrUnoCore } from '../src/index.js';
import { avrUno } from '../src/index.js';
import { firmware } from './firmware.js';

const core = (source: string) => avrUno.createCore(firmware(source)) as AvrUnoCore;
/** CPU registers r0–r31 sit at the start of the data space. */
const reg = (c: AvrUnoCore, r: number): number =>
  (c as unknown as { machine: { cpu: { data: Uint8Array } } }).machine.cpu.data[r] ?? -1;

/** Busy-waits for TWINT (bit 7 of TWCR). */
const waitTwint = (label: string) => `
${label}:
  lds r16, 0xBC
  sbrs r16, 7
  rjmp ${label}`;

describe('AvrUnoCore I²C and SPI', () => {
  it('runs a TWI write, repeated start and read through the attached handler, at the SCL bit rate', () => {
    const c = core(`
      ldi r16, 72          ; TWBR = 72: 16 MHz / (16 + 2·72) = 100 kHz
      sts 0xB8, r16
      ldi r16, 0xA4        ; TWINT | TWSTA | TWEN
      sts 0xBC, r16
      ${waitTwint('w1')}
      lds r20, 0xB9
      ldi r16, 0x78        ; SLA+W, address 0x3C
      sts 0xBB, r16
      ldi r16, 0x84        ; TWINT | TWEN
      sts 0xBC, r16
      ${waitTwint('w2')}
      lds r21, 0xB9
      ldi r16, 0x55
      sts 0xBB, r16
      ldi r16, 0x84
      sts 0xBC, r16
      ${waitTwint('w3')}
      lds r22, 0xB9
      ldi r16, 0xA4        ; repeated START
      sts 0xBC, r16
      ${waitTwint('w4')}
      ldi r16, 0x79        ; SLA+R
      sts 0xBB, r16
      ldi r16, 0x84
      sts 0xBC, r16
      ${waitTwint('w5')}
      ldi r16, 0x84        ; read one byte, NACK (TWEA = 0)
      sts 0xBC, r16
      ${waitTwint('w6')}
      lds r23, 0xBB
      lds r24, 0xB9
      ldi r16, 0x94        ; TWINT | TWSTO | TWEN
      sts 0xBC, r16
    halt: rjmp halt
    `);
    const log: string[] = [];
    const times: number[] = [];
    const handler: I2cBusHandler = {
      start: (repeated, t) => (log.push(repeated ? 'Sr' : 'S'), times.push(t)),
      connect: (address, read, t) => (
        log.push(`A${address.toString(16)}${read ? 'r' : 'w'}`),
        times.push(t),
        true
      ),
      write: (byte, t) => (log.push(`W${byte.toString(16)}`), times.push(t), true),
      read: (ack, t) => (log.push(`R${ack ? '+' : '-'}`), times.push(t), 0xc3),
      stop: (t) => (log.push('P'), times.push(t)),
    };
    c.attachI2c(handler);
    c.run(16_000); // 1 ms
    expect(log).toEqual(['S', 'A3cw', 'W55', 'Sr', 'A3cr', 'R-', 'P']);
    expect([reg(c, 20), reg(c, 21), reg(c, 22), reg(c, 23), reg(c, 24)]).toEqual([
      0x08, 0x18, 0x28, 0xc3, 0x58,
    ]);
    // Address and data bytes take 9 SCL periods at 100 kHz: 90 µs each.
    const [, connect = 0, write = 0] = times;
    expect(write - connect).toBeGreaterThan(90e-6);
    expect(write - connect).toBeLessThan(95e-6);
  });

  it('NACKs every address when nothing is attached', () => {
    const c = core(`
      ldi r16, 72
      sts 0xB8, r16
      ldi r16, 0xA4
      sts 0xBC, r16
      ${waitTwint('w1')}
      ldi r16, 0x78
      sts 0xBB, r16
      ldi r16, 0x84
      sts 0xBC, r16
      ${waitTwint('w2')}
      lds r21, 0xB9
    halt: rjmp halt
    `);
    c.run(16_000);
    expect(reg(c, 21)).toBe(0x20); // SLA+W sent, NACK received
  });

  it('exchanges SPI bytes with the attached handler', () => {
    const c = core(`
      ldi r16, 0x50        ; SPE | MSTR, f/4
      out 0x2C, r16
      ldi r16, 0xA5
      out 0x2E, r16
    w: in r16, 0x2D
      sbrs r16, 7
      rjmp w
      in r20, 0x2E
    halt: rjmp halt
    `);
    const sent: number[] = [];
    c.attachSpi({ transfer: (b) => (sent.push(b), 0x3c) });
    c.run(1000);
    expect(sent).toEqual([0xa5]);
    expect(reg(c, 20)).toBe(0x3c);
    expect(c.busPins).toEqual({ sda: 'A4', scl: 'A5', mosi: 'D11', miso: 'D12', sck: 'D13' });
  });
});
