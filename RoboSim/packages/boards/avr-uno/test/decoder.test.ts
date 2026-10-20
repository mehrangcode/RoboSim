import { CPU, avrInstruction as reference } from 'avr8js';
import { describe, expect, it } from 'vitest';
import { avr8jsInstructionSource, committedDecoder, generateDecoder } from '../scripts/gen-decoder.js';
import { AVR8JS_VERSION, avrInstruction } from '../src/decoder.generated.js';

describe('table-dispatched AVR interpreter', () => {
  it('is generated from the installed avr8js (run `pnpm gen:decoder` after bumping it)', () => {
    const { version, source } = avr8jsInstructionSource();
    expect(AVR8JS_VERSION).toBe(version);
    expect(committedDecoder()).toBe(generateDecoder(version, source));
  });

  it('executes every one of the 65 536 opcodes exactly as avr8js does', () => {
    // xorshift32: the same random machine state for both interpreters, different for every opcode.
    let seed = 0x9e3779b9;
    const rand = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return seed >>> 0;
    };
    const program = new Uint16Array(0x4000);
    const [a, b] = [new CPU(program.slice()), new CPU(program.slice())];
    const mismatches: string[] = [];
    for (let opcode = 0; opcode < 0x10000; opcode++) {
      const pc = 0x100 + (rand() & 0x1ff);
      const next = rand() & 0xffff;
      // General-purpose registers, SREG and the stack pointer; I/O space left alone (no peripherals here).
      const regs = Array.from({ length: 32 }, () => rand() & 0xff);
      const sreg = rand() & 0xff;
      const sp = 0x400 + (rand() & 0x3ff);
      for (const cpu of [a, b]) {
        cpu.data.fill(0);
        regs.forEach((v, i) => (cpu.data[i] = v));
        cpu.data[95] = sreg;
        cpu.SP = sp;
        cpu.progMem[pc] = opcode;
        cpu.progMem[pc + 1] = next;
        cpu.pc = pc;
        cpu.cycles = 0;
      }
      reference(a);
      avrInstruction(b);
      if (a.pc !== b.pc || a.cycles !== b.cycles || a.data.some((v, i) => v !== b.data[i]))
        mismatches.push(opcode.toString(16));
      a.progMem[pc] = b.progMem[pc] = 0;
      a.progMem[pc + 1] = b.progMem[pc + 1] = 0;
    }
    expect(mismatches).toEqual([]);
  });
});
