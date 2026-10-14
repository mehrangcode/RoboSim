import {
  AVRADC,
  AVRIOPort,
  AVRTimer,
  AVRUSART,
  CPU,
  PinState,
  adcConfig,
  avrInstruction,
  portBConfig,
  portCConfig,
  portDConfig,
  timer0Config,
  timer1Config,
  timer2Config,
  usart0Config,
  type AVRTimerConfig,
} from 'avr8js';
import type {
  FirmwareImage,
  Level,
  McuCore,
  PinDrive,
  PinId,
  PinMode,
  PinOutput,
  UartPort,
  Unsubscribe,
} from '@robosim/sim-core';
import { parseIntelHex } from './ihex.js';
import { UNO_MCU_PINS, type McuPinMap, type PortName } from './pins.js';
import { TIMER0_KIND, TIMER1_KIND, TIMER2_KIND, pwmFromRegisters, type TimerKind } from './pwm.js';

export const ATMEGA328P_FLASH_BYTES = 0x8000;
export const UNO_CLOCK_HZ = 16_000_000;

const TIMERS: readonly { readonly config: AVRTimerConfig; readonly kind: TimerKind }[] = [
  { config: timer0Config, kind: TIMER0_KIND },
  { config: timer1Config, kind: TIMER1_KIND },
  { config: timer2Config, kind: TIMER2_KIND },
];

interface PendingInput {
  readonly pin: McuPinMap;
  readonly drive: PinDrive;
  readonly atCycle: number;
}

interface Machine {
  readonly cpu: CPU;
  readonly ports: Readonly<Record<PortName, AVRIOPort>>;
  readonly adc: AVRADC;
  readonly usart: AVRUSART;
}

function modeOf(state: PinState): PinMode {
  if (state === PinState.Input) return 'input';
  if (state === PinState.InputPullUp) return 'input_pullup';
  return 'output';
}

/** ATmega328P firmware loaded into flash words (little-endian byte pairs). */
export function loadFirmware(fw: FirmwareImage): Uint16Array {
  if (fw.format !== 'ihex') throw new Error(`avr-uno accepts Intel HEX firmware, got '${fw.format}'`);
  let text = '';
  for (const b of fw.bytes) text += String.fromCharCode(b); // Intel HEX is plain ASCII
  const image = parseIntelHex(text, ATMEGA328P_FLASH_BYTES);
  const words = new Uint16Array(ATMEGA328P_FLASH_BYTES / 2);
  for (let i = 0; i < words.length; i++)
    words[i] = (image[2 * i] ?? 0xff) | ((image[2 * i + 1] ?? 0xff) << 8);
  return words;
}

/**
 * avr8js adapter implementing {@link McuCore} for the Uno (Technical Design §5.2): executes firmware
 * cycle by cycle, applies scheduled inputs at their exact cycle, derives PWM from timer registers,
 * and reports cycle-stamped edges on output pins.
 */
export class AvrUnoCore implements McuCore {
  readonly clockHz = UNO_CLOCK_HZ;
  private machine: Machine;
  private queue: PendingInput[] = [];
  private queueHead = 0;
  private readonly rxQueue: number[] = [];
  private readonly edgeListeners = new Set<(pin: PinId, level: Level, cycle: number) => void>();
  private readonly uartListeners = new Set<(bytes: Uint8Array) => void>();
  private readonly lastEdgeLevel = new Map<PinId, Level>();
  private readonly pinById = new Map(UNO_MCU_PINS.map((p) => [p.id, p]));

  constructor(private readonly program: Uint16Array) {
    this.machine = this.build();
  }

  static fromFirmware(fw: FirmwareImage): AvrUnoCore {
    return new AvrUnoCore(loadFirmware(fw));
  }

  get cycle(): number {
    return this.machine.cpu.cycles;
  }

  run(untilCycle: number): void {
    const { cpu, usart } = this.machine;
    while (cpu.cycles < untilCycle) {
      this.applyDueInputs(cpu.cycles);
      if (this.rxQueue.length > 0 && usart.rxEnable && !usart.rxBusy)
        usart.writeByte(this.rxQueue.shift() ?? 0);
      avrInstruction(cpu);
      cpu.tick();
    }
  }

  scheduleInput(pin: PinId, drive: PinDrive, atCycle: number): void {
    const map = this.pinById.get(pin);
    if (!map) throw new Error(`Unknown Uno pin '${pin}'`);
    const entry: PendingInput = { pin: map, drive, atCycle };
    // Keep the pending tail sorted by cycle; equal cycles stay in arrival order.
    let i = this.queue.length;
    while (i > this.queueHead && (this.queue[i - 1]?.atCycle ?? 0) > atCycle) i--;
    this.queue.splice(i, 0, entry);
  }

  pinOutputs(): ReadonlyMap<PinId, PinOutput> {
    const { ports } = this.machine;
    const out = new Map<PinId, PinOutput>();
    for (const p of UNO_MCU_PINS) {
      const state = ports[p.port].pinState(p.bit);
      const mode = modeOf(state);
      const level: Level = state === PinState.High ? 1 : 0;
      const timer = p.oc ? TIMERS[p.oc.timer] : undefined;
      const pwm =
        mode === 'output' && p.oc && timer
          ? pwmFromRegisters(this.timerRegisters(timer.config), timer.kind, p.oc.channel, this.clockHz)
          : null;
      out.set(p.id, pwm ? { mode, level, pwm } : { mode, level });
    }
    return out;
  }

  onPinEdge(cb: (pin: PinId, level: Level, cycle: number) => void): Unsubscribe {
    this.edgeListeners.add(cb);
    return () => this.edgeListeners.delete(cb);
  }

  uart(index: number): UartPort {
    if (index !== 0) throw new Error(`ATmega328P has one USART, got index ${index}`);
    return {
      write: (bytes) => this.rxQueue.push(...bytes),
      onData: (cb) => {
        this.uartListeners.add(cb);
        return () => this.uartListeners.delete(cb);
      },
    };
  }

  reset(): void {
    this.queue = [];
    this.queueHead = 0;
    this.rxQueue.length = 0;
    this.lastEdgeLevel.clear();
    this.machine = this.build();
  }

  private build(): Machine {
    const cpu = new CPU(this.program.slice());
    for (const { config } of TIMERS) new AVRTimer(cpu, config);
    const ports: Record<PortName, AVRIOPort> = {
      B: new AVRIOPort(cpu, portBConfig),
      C: new AVRIOPort(cpu, portCConfig),
      D: new AVRIOPort(cpu, portDConfig),
    };
    const adc = new AVRADC(cpu, adcConfig);
    const usart = new AVRUSART(cpu, usart0Config, UNO_CLOCK_HZ);
    usart.onByteTransmit = (byte) => {
      const data = Uint8Array.of(byte);
      for (const cb of this.uartListeners) cb(data);
    };
    for (const name of ['B', 'C', 'D'] as const) {
      const pins = UNO_MCU_PINS.filter((p) => p.port === name);
      ports[name].addListener(() => this.emitEdges(ports[name], pins, cpu));
    }
    return { cpu, ports, adc, usart };
  }

  private emitEdges(port: AVRIOPort, pins: readonly McuPinMap[], cpu: CPU): void {
    if (this.edgeListeners.size === 0) return;
    for (const p of pins) {
      const state = port.pinState(p.bit);
      if (state !== PinState.High && state !== PinState.Low) continue;
      const level: Level = state === PinState.High ? 1 : 0;
      if (this.lastEdgeLevel.get(p.id) === level) continue;
      const first = !this.lastEdgeLevel.has(p.id);
      this.lastEdgeLevel.set(p.id, level);
      if (first && level === 0) continue; // pin just became an output at its reset level: not an edge
      for (const cb of this.edgeListeners) cb(p.id, level, cpu.cycles);
    }
  }

  private applyDueInputs(cycle: number): void {
    while (this.queueHead < this.queue.length) {
      const next = this.queue[this.queueHead];
      if (!next || next.atCycle > cycle) break;
      this.queueHead++;
      const { pin, drive } = next;
      this.machine.ports[pin.port].setPin(pin.bit, drive.level === 1);
      if (pin.adc !== undefined) this.machine.adc.channelValues[pin.adc] = drive.volts;
    }
    if (this.queueHead > 1024) {
      this.queue = this.queue.slice(this.queueHead);
      this.queueHead = 0;
    }
  }

  private timerRegisters(config: AVRTimerConfig): {
    tccra: number;
    tccrb: number;
    ocrA: number;
    ocrB: number;
    icr: number;
  } {
    const d = this.machine.cpu.data;
    const word = (addr: number): number => (d[addr] ?? 0) | ((d[addr + 1] ?? 0) << 8);
    const sixteen = config === timer1Config;
    return {
      tccra: d[config.TCCRA] ?? 0,
      tccrb: d[config.TCCRB] ?? 0,
      ocrA: sixteen ? word(config.OCRA) : (d[config.OCRA] ?? 0),
      ocrB: sixteen ? word(config.OCRB) : (d[config.OCRB] ?? 0),
      icr: sixteen ? word(config.ICR) : 0,
    };
  }
}
