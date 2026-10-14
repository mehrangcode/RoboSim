import type { CircuitSpec } from '@robosim/sim-core';
import { dcSupply } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { analyze, def } from '../../test/helpers.js';
import {
  backfeed,
  inductiveOnPin,
  ledNoResistor,
  mcuTotalCurrent,
  noCommonGround,
  overvoltage,
  pinCurrent,
  reversePolarity,
  shortCircuit,
  supplyOverload,
} from './static-rules.js';

const ids = (spec: CircuitSpec, rule: Parameters<typeof analyze>[0]) =>
  analyze(rule, spec).map((f) => `${f.ruleId}:${f.severity}:${[...f.componentIds, ...f.pinIds].join('+')}`);

describe('FR-SAF-02 static rules — trigger and clean fixtures', () => {
  it('(1) motor directly on an MCU pin', () => {
    const trigger: CircuitSpec = {
      parts: { m: { def: def('actuator.tt-motor') } },
      wires: [['m.m1', 'mcu.D9']],
      ground: ['m.m2'],
      mcuPins: ['D9'],
    };
    const clean: CircuitSpec = {
      parts: { bat: { def: def('power.battery-4aa') }, m: { def: def('actuator.tt-motor') } },
      wires: [['bat.pos', 'm.m1']],
      ground: ['bat.neg', 'm.m2'],
    };
    expect(ids(trigger, inductiveOnPin)).toEqual(['SAF-INDUCTIVE-ON-PIN:error:m+D9']);
    expect(ids(clean, inductiveOnPin)).toEqual([]);
  });

  it('(2) LED without series resistance — on a battery and on a pin', () => {
    const onBattery: CircuitSpec = {
      parts: { bat: { def: def('power.battery-9v') }, led: { def: def('actuator.led') } },
      wires: [['bat.pos', 'led.a']],
      ground: ['bat.neg', 'led.k'],
    };
    const onPin: CircuitSpec = {
      parts: { led: { def: def('actuator.led') } },
      wires: [['mcu.D13', 'led.a']],
      ground: ['led.k'],
      mcuPins: ['D13'],
    };
    const clean: CircuitSpec = {
      parts: {
        bat: { def: def('power.battery-9v') },
        r: { def: def('passive.resistor'), props: { ohms: 1000 } },
        led: { def: def('actuator.led') },
      },
      wires: [
        ['bat.pos', 'r.a'],
        ['r.b', 'led.a'],
      ],
      ground: ['bat.neg', 'led.k'],
    };
    expect(ids(onBattery, ledNoResistor)).toEqual(['SAF-LED-NO-RESISTOR:error:led']);
    expect(ids(onPin, ledNoResistor)).toEqual(['SAF-LED-NO-RESISTOR:error:led+D13']);
    expect(ids(clean, ledNoResistor)).toEqual([]);
  });

  it('(3) short circuit between supply and ground', () => {
    const trigger: CircuitSpec = {
      parts: { bat: { def: def('power.battery-9v') } },
      ground: ['bat.neg', 'bat.pos'],
    };
    const viaWire: CircuitSpec = {
      parts: {
        bat: { def: def('power.battery-9v') },
        sw: { def: def('power.switch') },
        r: { def: def('passive.resistor'), props: { ohms: 0.1 } },
      },
      wires: [['bat.pos', 'r.a']],
      ground: ['bat.neg', 'r.b'],
    };
    const clean: CircuitSpec = {
      parts: {
        bat: { def: def('power.battery-9v') },
        r: { def: def('passive.resistor'), props: { ohms: 1000 } },
      },
      wires: [['bat.pos', 'r.a']],
      ground: ['bat.neg', 'r.b'],
    };
    expect(ids(trigger, shortCircuit)).toEqual(['SAF-SHORT-CIRCUIT:error:bat']);
    expect(ids(viaWire, shortCircuit)).toEqual(['SAF-SHORT-CIRCUIT:error:bat']);
    expect(ids(clean, shortCircuit)).toEqual([]);
  });

  it('(4) over-voltage on a part, on the L298N 5 V terminal, and on an MCU pin', () => {
    const buzzer = (bat: string): CircuitSpec => ({
      parts: { bat: { def: def(bat) }, bz: { def: def('actuator.buzzer-active') } },
      wires: [['bat.pos', 'bz.pos']],
      ground: ['bat.neg', 'bz.neg'],
    });
    const l298nV5: CircuitSpec = {
      parts: {
        bat: { def: def('power.battery-9v') },
        drv: { def: def('driver.l298n'), props: { regulatorJumper: false } },
      },
      wires: [['bat.pos', 'drv.v5']],
      ground: ['bat.neg', 'drv.gnd'],
    };
    const mcuPin: CircuitSpec = {
      parts: { bat: { def: def('power.battery-9v') } },
      wires: [['bat.pos', 'mcu.D2']],
      ground: ['bat.neg'],
      mcuPins: ['D2'],
    };
    expect(ids(buzzer('power.battery-9v'), overvoltage)).toEqual(['SAF-OVERVOLTAGE:error:bz']);
    expect(ids(buzzer('power.battery-4aa'), overvoltage)).toEqual([]);
    expect(ids(l298nV5, overvoltage)).toEqual(['SAF-OVERVOLTAGE:error:drv']);
    expect(ids(mcuPin, overvoltage)).toEqual(['SAF-OVERVOLTAGE:error:D2']);
  });

  it('(5) reversed polarity', () => {
    const wired = (reversed: boolean): CircuitSpec => ({
      parts: { bat: { def: def('power.battery-4aa') }, bz: { def: def('actuator.buzzer-active') } },
      wires: [['bat.pos', reversed ? 'bz.neg' : 'bz.pos']],
      ground: ['bat.neg', reversed ? 'bz.pos' : 'bz.neg'],
    });
    expect(ids(wired(true), reversePolarity)).toEqual(['SAF-REVERSE-POLARITY:error:bz']);
    expect(ids(wired(false), reversePolarity)).toEqual([]);
  });

  it('(6) per-pin current: > 20 mA Warning, > 40 mA Error', () => {
    const load = (ohms: number): CircuitSpec => ({
      parts: { r: { def: def('passive.resistor'), props: { ohms } } },
      wires: [['mcu.D13', 'r.a']],
      ground: ['r.b'],
      mcuPins: ['D13'],
    });
    expect(ids(load(47), pinCurrent)).toEqual(['SAF-PIN-CURRENT:error:D13']);
    expect(ids(load(180), pinCurrent)).toEqual(['SAF-PIN-CURRENT:warning:D13']);
    expect(ids(load(1000), pinCurrent)).toEqual([]);
  });

  it('(6) pins wired to a sensor output are inputs by design and are not drive-probed', () => {
    const sensor: CircuitSpec = {
      parts: { rail: { def: dcSupply, props: { volts: 5 } }, line: { def: def('sensor.line-3ch') } },
      wires: [
        ['rail.pos', 'line.vcc'],
        ['line.left', 'mcu.D2'],
      ],
      ground: ['rail.neg', 'line.gnd'],
      mcuPins: ['D2'],
    };
    expect(ids(sensor, pinCurrent)).toEqual([]);
  });

  it('(7) total MCU current above the package limit (Warning: possible if all outputs are on)', () => {
    const pins = ['D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9'];
    const many: CircuitSpec = {
      parts: Object.fromEntries(
        pins.map((p) => [`r${p}`, { def: def('passive.resistor'), props: { ohms: 150 } }]),
      ),
      wires: pins.map((p) => [`mcu.${p}`, `r${p}.a`] as const),
      ground: pins.map((p) => `r${p}.b`),
      mcuPins: pins,
    };
    const few: CircuitSpec = { ...many, mcuPins: pins.slice(0, 2), wires: many.wires?.slice(0, 2) ?? [] };
    expect(ids(many, mcuTotalCurrent)).toEqual(['SAF-MCU-TOTAL-CURRENT:warning:']);
    expect(ids(few, mcuTotalCurrent)).toEqual([]);
  });

  it('(8) two servos at stall exceed a 500 mA 5 V supply', () => {
    const servos = (n: number): CircuitSpec => ({
      parts: {
        rail: { def: dcSupply, props: { volts: 5 } },
        ...Object.fromEntries(
          Array.from({ length: n }, (_, i) => [`s${i}`, { def: def('actuator.sg90-servo') }]),
        ),
      },
      wires: Array.from({ length: n }, (_, i) => ['rail.pos', `s${i}.vcc`] as const),
      ground: ['rail.neg', ...Array.from({ length: n }, (_, i) => `s${i}.gnd`)],
    });
    expect(ids(servos(2), supplyOverload)).toEqual(['SAF-SUPPLY-OVERLOAD:error:rail+s0+s1']);
    expect(ids(servos(0), supplyOverload)).toEqual([]);
  });

  it('(10) supply ground not tied to the common ground', () => {
    const floating: CircuitSpec = {
      parts: { bat: { def: def('power.battery-4aa') }, r: { def: def('passive.resistor') } },
      wires: [
        ['bat.pos', 'r.a'],
        ['r.b', 'bat.neg'],
      ],
    };
    const tied: CircuitSpec = { ...floating, ground: ['bat.neg'] };
    expect(ids(floating, noCommonGround)).toEqual(['SAF-NO-COMMON-GROUND:warning:bat']);
    expect(ids(tied, noCommonGround)).toEqual([]);
  });

  it('(11) back-feeding: two supply outputs on one rail', () => {
    const two: CircuitSpec = {
      parts: { a: { def: def('power.battery-4aa') }, b: { def: def('power.battery-9v') } },
      wires: [['a.pos', 'b.pos']],
      ground: ['a.neg', 'b.neg'],
    };
    const regulator: CircuitSpec = {
      parts: { usb: { def: dcSupply, props: { volts: 5 } }, drv: { def: def('driver.l298n') } },
      wires: [['usb.pos', 'drv.v5']],
      ground: ['usb.neg', 'drv.gnd'],
    };
    expect(ids(two, backfeed)).toEqual(['SAF-BACKFEED:error:a+b']);
    expect(ids(regulator, backfeed)).toEqual(['SAF-BACKFEED:error:usb+drv']);
    expect(
      ids(
        {
          ...regulator,
          parts: { ...regulator.parts, drv: { def: def('driver.l298n'), props: { regulatorJumper: false } } },
        },
        backfeed,
      ),
    ).toEqual([]);
  });
});
