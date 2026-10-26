import {
  AVRADC,
  AVREEPROM,
  AVRIOPort,
  AVRSPI,
  AVRTWI,
  AVRTimer,
  AVRUSART,
  CPU,
  EEPROMMemoryBackend,
  PinState,
  adcConfig,
  eepromConfig,
  portBConfig,
  portCConfig,
  portDConfig,
  spiConfig,
  timer0Config,
  timer1Config,
  timer2Config,
  twiConfig,
  usart0Config,
  type AVRTimerConfig,
  type TWIEventHandler,
} from 'avr8js';
import type {
  BusPins,
  FirmwareImage,
  I2cBusHandler,
  Level,
  McuCore,
  PinDrive,
  PinId,
  PinMode,
  PinOutput,
  SpiBusHandler,
  UartPort,
  Unsubscribe,
} from '@robosim/sim-core';
import { avrInstruction } from './decoder.generated.js';
import { parseIntelHex } from './ihex.js';
import { UNO_MCU_PINS, type McuPinMap, type PortName } from './pins.js';
import { TIMER0_KIND, TIMER1_KIND, TIMER2_KIND, pwmFromRegisters, type TimerKind } from './pwm.js';

export const ATMEGA328P_FLASH_BYTES = 0x8000;
export const ATMEGA328P_EEPROM_BYTES = 1024;
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
  readonly twi: AVRTWI;
  readonly spi: AVRSPI;
}

/** Uno R3: TWI on A4/A5 (PC4/PC5), SPI on D11–D13 (PB3–PB5). */
export const UNO_BUS_PINS: BusPins = { sda: 'A4', scl: 'A5', mosi: 'D11', miso: 'D12', sck: 'D13' };

/** UCSR0A read-only status bits (ATmega328P datasheet §20.11.2). */
const UCSRA_RXC = 0x80;
const UCSRA_UDRE = 0x20;

/** I²C clock periods per byte on the wire: 8 data bits and the ACK. */
const I2C_BYTE_BITS = 9;

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
  readonly busPins = UNO_BUS_PINS;
  private i2cHandler: I2cBusHandler | null = null;
  private spiHandler: SpiBusHandler | null = null;
  private machine: Machine;
  private queue: PendingInput[] = [];
  private queueHead = 0;
  /** Bytes waiting for the receiver; consumed from `rxHead` (shift() is O(n) per byte on big pastes). */
  private rxQueue: number[] = [];
  private rxHead = 0;
  private readonly edgeListeners = new Set<(pin: PinId, level: Level, cycle: number) => void>();
  private readonly uartListeners = new Set<(bytes: Uint8Array) => void>();
  private readonly lastEdgeLevel = new Map<PinId, Level>();
  private readonly inputListeners = new Set<(pin: PinId, level: Level, cycle: number) => void>();
  private readonly lastInputLevel = new Map<PinId, Level>();
  private readonly modeListeners = new Set<
    (pin: PinId, mode: PinMode, cycle: number, level: Level) => void
  >();
  /** Last reported mode per pin; every pin resets as an input. */
  private readonly lastMode = new Map<PinId, PinMode>();
  private readonly pinById = new Map(UNO_MCU_PINS.map((p) => [p.id, p]));
  /** Erased (0xFF) like a new chip; it keeps its contents across `reset()`, as on the real part. */
  private readonly eeprom = new EEPROMMemoryBackend(ATMEGA328P_EEPROM_BYTES);

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
      // Inputs may be scheduled from inside an instruction (edge listeners), so check the head each time.
      const next = this.queue[this.queueHead];
      if (next && next.atCycle <= cpu.cycles) this.applyDueInputs(cpu.cycles);
      if (this.rxHead < this.rxQueue.length && usart.rxEnable && !usart.rxBusy) this.receiveNext(usart);
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

  onPinInput(cb: (pin: PinId, level: Level, cycle: number) => void): Unsubscribe {
    this.inputListeners.add(cb);
    return () => this.inputListeners.delete(cb);
  }

  onPinModeChange(cb: (pin: PinId, mode: PinMode, cycle: number, level: Level) => void): Unsubscribe {
    this.modeListeners.add(cb);
    return () => this.modeListeners.delete(cb);
  }

  uart(index: number): UartPort {
    if (index !== 0) throw new Error(`ATmega328P has one USART, got index ${index}`);
    return {
      write: (bytes) => {
        for (const b of bytes) this.rxQueue.push(b); // no spread: a pasted file can be megabytes
      },
      baud: () => {
        const usart = this.machine.usart;
        return usart.txEnable ? usart.baudRate : 0;
      },
      onData: (cb) => {
        this.uartListeners.add(cb);
        return () => this.uartListeners.delete(cb);
      },
    };
  }

  attachI2c(handler: I2cBusHandler): Unsubscribe {
    this.i2cHandler = handler;
    return () => {
      if (this.i2cHandler === handler) this.i2cHandler = null;
    };
  }

  attachSpi(handler: SpiBusHandler): Unsubscribe {
    this.spiHandler = handler;
    return () => {
      if (this.spiHandler === handler) this.spiHandler = null;
    };
  }

  reset(): void {
    this.queue = [];
    this.queueHead = 0;
    this.rxQueue = [];
    this.rxHead = 0;
    this.lastEdgeLevel.clear();
    this.lastInputLevel.clear();
    this.lastMode.clear();
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
    new AVREEPROM(cpu, this.eeprom, eepromConfig);
    const twi = new AVRTWI(cpu, twiConfig, UNO_CLOCK_HZ);
    twi.eventHandler = this.twiEvents(cpu, twi);
    const spi = new AVRSPI(cpu, spiConfig, UNO_CLOCK_HZ);
    spi.onByte = (value) => {
      const time = cpu.cycles / UNO_CLOCK_HZ;
      const miso = this.spiHandler?.transfer(value, time) ?? 0xff;
      cpu.addClockEvent(() => spi.completeTransfer(miso), spi.transferCycles);
    };
    const usart = new AVRUSART(cpu, usart0Config, UNO_CLOCK_HZ);
    this.bufferTransmitter(cpu, usart);
    for (const name of ['B', 'C', 'D'] as const) {
      const pins = UNO_MCU_PINS.filter((p) => p.port === name);
      ports[name].addListener(() => {
        this.emitModes(ports[name], pins, cpu);
        this.emitEdges(ports[name], pins, cpu);
      });
    }
    return { cpu, ports, adc, usart, twi, spi };
  }

  /**
   * TWI master events → the attached I²C handler, each completed after its time on the wire at the
   * SCL frequency from TWBR/TWSR (so `Wire.setClock` matters). Without a handler nothing answers.
   */
  private twiEvents(cpu: CPU, twi: AVRTWI): TWIEventHandler {
    const later = (bits: number, done: () => void): void => {
      const cycles = Math.max(1, Math.round((bits * UNO_CLOCK_HZ) / twi.sclFrequency));
      cpu.addClockEvent(done, cycles);
    };
    const now = (): number => cpu.cycles / UNO_CLOCK_HZ;
    return {
      start: (repeated) => {
        this.i2cHandler?.start(repeated, now());
        later(1, () => twi.completeStart());
      },
      stop: () => {
        this.i2cHandler?.stop(now());
        later(1, () => twi.completeStop());
      },
      connectToSlave: (address, write) => {
        const ack = this.i2cHandler?.connect(address, !write, now()) ?? false;
        later(I2C_BYTE_BITS, () => twi.completeConnect(ack));
      },
      writeByte: (value) => {
        const ack = this.i2cHandler?.write(value, now()) ?? false;
        later(I2C_BYTE_BITS, () => twi.completeWrite(ack));
      },
      readByte: (ack) => {
        const value = this.i2cHandler?.read(ack, now()) ?? 0xff;
        later(I2C_BYTE_BITS, () => twi.completeRead(value));
      },
    };
  }

  /**
   * The ATmega328P transmitter is double-buffered: UDR hands its byte to the shift register at once when
   * that is idle, so the next byte can wait in UDR and frames go out back to back. avr8js signals UDRE
   * only after a whole frame, which adds the UDRE interrupt latency to every byte (≈ 5 % slower output at
   * 115200 baud). This replaces its UDR write hook; a byte is reported when it starts on the wire.
   */
  private bufferTransmitter(cpu: CPU, usart: AVRUSART): void {
    type Interrupt = Parameters<CPU['setInterruptFlag']>[0];
    const internals = usart as unknown as { UDRE: Interrupt; TXC: Interrupt; cyclesPerChar: number };
    const { UDRE, TXC } = internals;
    let shifting = false;
    let buffered: number | null = null;
    const startFrame = (byte: number): void => {
      shifting = true;
      const data = Uint8Array.of(byte);
      for (const cb of this.uartListeners) cb(data);
      cpu.addClockEvent(endFrame, internals.cyclesPerChar);
    };
    const endFrame = (): void => {
      if (buffered === null) {
        shifting = false;
        cpu.setInterruptFlag(TXC);
        return;
      }
      const byte = buffered;
      buffered = null;
      startFrame(byte);
      cpu.setInterruptFlag(UDRE);
    };
    // RXC and UDRE are read-only status bits; avr8js's UCSRA hook clears them on every write (Serial.write
    // writes UCSRA to clear TXC), which would stall the buffer and could drop a received byte's flag.
    const statusHook = cpu.writeHooks[usart0Config.UCSRA];
    cpu.writeHooks[usart0Config.UCSRA] = (value, oldValue, addr, mask) => {
      const handled = statusHook?.(value, oldValue, addr, mask);
      cpu.data[usart0Config.UCSRA] =
        (cpu.data[usart0Config.UCSRA] ?? 0) | (oldValue & (UCSRA_RXC | UCSRA_UDRE));
      return handled;
    };
    cpu.writeHooks[usart0Config.UDR] = (value) => {
      cpu.clearInterrupt(TXC);
      if (shifting) {
        buffered = value;
        cpu.clearInterrupt(UDRE);
      } else {
        startFrame(value);
        cpu.setInterruptFlag(UDRE);
      }
      return true;
    };
  }

  private emitModes(port: AVRIOPort, pins: readonly McuPinMap[], cpu: CPU): void {
    if (this.modeListeners.size === 0) return;
    for (const p of pins) {
      const state = port.pinState(p.bit);
      const mode = modeOf(state);
      if ((this.lastMode.get(p.id) ?? 'input') === mode) continue;
      this.lastMode.set(p.id, mode);
      const level: Level = state === PinState.High ? 1 : 0;
      for (const cb of this.modeListeners) cb(p.id, mode, cpu.cycles, level);
    }
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

  private receiveNext(usart: AVRUSART): void {
    usart.writeByte(this.rxQueue[this.rxHead++] ?? 0);
    if (this.rxHead > 4096) {
      this.rxQueue = this.rxQueue.slice(this.rxHead);
      this.rxHead = 0;
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
      if (this.lastInputLevel.get(pin.id) !== drive.level) {
        this.lastInputLevel.set(pin.id, drive.level);
        for (const cb of this.inputListeners) cb(pin.id, drive.level, next.atCycle);
      }
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
