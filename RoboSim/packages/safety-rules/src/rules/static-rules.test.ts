import type { CircuitSpec, ComponentDefinition, NetId } from '@robosim/sim-core';
import { dcSupply } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { analyze, def } from '../../test/helpers.js';
import {
  backfeed,
  baseNoResistor,
  capacitorStress,
  flyback,
  i2cAddress,
  i2cLevel,
  i2cPullUp,
  mosfetGate,
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
    // An LED strip's peak current scales with its length: 8 WS2812B ≈ 300 mA, 30 ≈ 1.1 A.
    const strip = (count: number): CircuitSpec => ({
      parts: {
        rail: { def: dcSupply, props: { volts: 5 } },
        led: { def: def('actuator.ws2812-strip'), props: { count } },
      },
      wires: [['rail.pos', 'led.vcc']],
      ground: ['rail.neg', 'led.gnd'],
    });
    expect(ids(strip(8), supplyOverload)).toEqual([]);
    expect(analyze(supplyOverload, strip(30))[0]?.params).toMatchObject({ ma: 1110, limit: 500 });
  });

  it('(10) supply ground not tied to the common ground', () => {
    // A battery-powered signal into D2 only works when the grounds are joined.
    const floating: CircuitSpec = {
      parts: { bat: { def: def('power.battery-4aa') }, r: { def: def('passive.resistor') } },
      wires: [
        ['bat.pos', 'r.a'],
        ['r.b', 'mcu.D2'],
      ],
      mcuPins: ['D2'],
    };
    const tied: CircuitSpec = { ...floating, ground: ['bat.neg'] };
    expect(ids(floating, noCommonGround)).toEqual(['SAF-NO-COMMON-GROUND:warning:bat']);
    expect(ids(tied, noCommonGround)).toEqual([]);
  });

  it('(10) a circuit isolated behind relay contacts needs no common ground', () => {
    const relayLamp: CircuitSpec = {
      parts: {
        relay: { def: def('actuator.relay-module') },
        bat: { def: def('power.battery-9v') },
        lamp: { def: def('passive.resistor') },
      },
      wires: [
        ['mcu.D12', 'relay.in'],
        ['bat.pos', 'relay.com'],
        ['relay.no', 'lamp.a'],
        ['lamp.b', 'bat.neg'],
      ],
      ground: ['relay.gnd'],
      mcuPins: ['D12'],
    };
    expect(ids(relayLamp, noCommonGround)).toEqual([]);
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

  it('(Tier B) electrolytic capacitor reversed or above its rating; a correct one is clean', () => {
    const cap = (pos: string, props: Record<string, number | string> = {}): CircuitSpec => ({
      parts: {
        bat: { def: def('power.battery-9v') },
        c: { def: def('passive.capacitor-electrolytic'), props },
      },
      wires: [[pos === 'pos' ? 'bat.pos' : 'bat.neg', 'c.pos']],
      ground: [pos === 'pos' ? 'bat.neg' : 'bat.pos', 'c.neg'],
    });
    expect(ids(cap('neg'), capacitorStress)).toEqual(['SAF-CAPACITOR:error:c']);
    expect(analyze(capacitorStress, cap('neg'))[0]?.params).toMatchObject({ problem: 'reversed' });
    const over = analyze(capacitorStress, cap('pos', { ratedVoltage: 'v6_3' }));
    expect(over.map((f) => f.params)).toEqual([
      { part: 'c', problem: 'overvoltage', volts: 9.5, limit: 7.2 },
    ]);
    expect(ids(cap('pos', { ratedVoltage: 'v16' }), capacitorStress)).toEqual([]);
  });

  it('(Tier B) transistor base wired straight to a pin; a 1 kΩ base resistor is clean', () => {
    const spec = (withResistor: boolean): CircuitSpec => ({
      parts: {
        bat: { def: def('power.battery-9v') },
        load: { def: def('passive.resistor'), props: { ohms: 220 } },
        q: { def: def('semiconductor.2n2222') },
        ...(withResistor ? { rb: { def: def('passive.resistor'), props: { ohms: 1000 } } } : {}),
      },
      wires: [
        ['bat.pos', 'load.a'],
        ['load.b', 'q.c'],
        ...(withResistor
          ? ([
              ['mcu.D9', 'rb.a'],
              ['rb.b', 'q.b'],
            ] as const)
          : ([['mcu.D9', 'q.b']] as const)),
      ],
      ground: ['bat.neg', 'q.e'],
      mcuPins: ['D9'],
    });
    expect(ids(spec(false), baseNoResistor)).toEqual(['SAF-BASE-NO-RESISTOR:error:q+D9']);
    expect(ids(spec(true), baseNoResistor)).toEqual([]);
  });

  it('(Tier B) IRF520 module from a 5 V pin carrying a motor is only partly on; an IRLZ44N is clean', () => {
    const module: CircuitSpec = {
      parts: {
        bat: { def: def('power.battery-4aa') },
        m: { def: def('driver.irf520-module') },
        motor: { def: def('actuator.tt-motor') },
      },
      wires: [
        ['bat.pos', 'm.vin'],
        ['m.vplus', 'motor.m1'],
        ['motor.m2', 'm.vminus'],
        ['mcu.D9', 'm.sig'],
      ],
      ground: ['bat.neg', 'm.gnd'],
      mcuPins: ['D9'],
    };
    const logicLevel: CircuitSpec = {
      parts: {
        bat: { def: def('power.battery-4aa') },
        rg: { def: def('passive.resistor'), props: { ohms: 220 } },
        q: { def: def('semiconductor.irlz44n') },
        motor: { def: def('actuator.tt-motor') },
      },
      wires: [
        ['bat.pos', 'motor.m1'],
        ['motor.m2', 'q.d'],
        ['mcu.D9', 'rg.a'],
        ['rg.b', 'q.g'],
      ],
      ground: ['bat.neg', 'q.s'],
      mcuPins: ['D9'],
    };
    expect(ids(module, mosfetGate)).toEqual(['SAF-MOSFET-GATE:warning:m+D9']);
    expect(analyze(mosfetGate, module)[0]?.params).toMatchObject({ part: 'm', needed: 10 });
    expect(ids(logicLevel, mosfetGate)).toEqual([]);
  });

  it('(Tier B) motor switched by a TIP120 without a flyback diode kicks back; with a 1N4007 it is clean', () => {
    const spec = (diode: boolean): CircuitSpec => ({
      parts: {
        bat: { def: def('power.battery-4aa') },
        rb: { def: def('passive.resistor'), props: { ohms: 1000 } },
        q: { def: def('semiconductor.tip120') },
        motor: { def: def('actuator.tt-motor') },
        ...(diode ? { d: { def: def('semiconductor.diode-1n4007') } } : {}),
      },
      wires: [
        ['bat.pos', 'motor.m1'],
        ['motor.m2', 'q.c'],
        ['mcu.D9', 'rb.a'],
        ['rb.b', 'q.b'],
        ...(diode
          ? ([
              ['d.a', 'motor.m2'],
              ['d.k', 'motor.m1'],
            ] as const)
          : []),
      ],
      ground: ['bat.neg', 'q.e'],
      mcuPins: ['D9'],
    });
    const found = analyze(flyback, spec(false));
    expect(
      found.map((f) => `${f.ruleId}:${f.severity}:${[...f.componentIds, ...f.pinIds].join('+')}`),
    ).toEqual(['SAF-FLYBACK:error:motor+q+D9']);
    expect(Number(found[0]?.params['volts'])).toBeGreaterThan(55); // the TIP120 breaks down at 60 V
    expect(ids(spec(true), flyback)).toEqual([]);
  });

  describe('(Tier C) I²C bus', () => {
    /** A bare I²C chip (no breakout pull-ups) answering 0x50. */
    const bareChip: ComponentDefinition = {
      manifest: {
        id: 'test.i2c-chip',
        version: '1.0.0',
        category: 'ic',
        tier: 'pro',
        phase: 'P2',
        nameKey: 'test.i2c-chip.name',
        pins: [
          { name: 'vcc', kind: 'power' },
          { name: 'gnd', kind: 'ground' },
          { name: 'sda', kind: 'digital' },
          { name: 'scl', kind: 'digital' },
        ],
        props: {},
        inputs: [],
        massG: 0,
        limits: {},
        polarity: ['vcc', 'gnd'],
        i2c: { sda: 'sda', scl: 'scl', address: 0x50 },
      },
      create: () => {
        let vcc: NetId = 0;
        return {
          type: 'test.i2c-chip',
          init: (ctx) => void (vcc = ctx.net('vcc')),
          stamp: (s) => s.conductance(vcc, 0, 1e-4),
          step: () => undefined,
          faults: () => [],
          snapshot: () => null,
        };
      },
    };
    const bus = (parts: CircuitSpec['parts'], extra: CircuitSpec['wires'] = []): CircuitSpec => ({
      parts: { src: { def: dcSupply, props: { volts: 5, ohms: 0.01 } }, ...parts },
      wires: [
        ...Object.keys(parts).flatMap((id) => [
          [`${id}.sda`, 'mcu.A4'] as const,
          [`${id}.scl`, 'mcu.A5'] as const,
        ]),
        ...extra,
      ],
      ground: ['src.neg', ...Object.keys(parts).map((id) => `${id}.gnd`)],
      mcuPins: ['A4', 'A5'],
    });
    const power = (...ids: string[]) => ids.map((id) => ['src.pos', `${id}.vcc`] as const);

    it('a bus with no pull-up warns on each line; a breakout with pull-ups is clean', () => {
      expect(ids(bus({ chip: { def: bareChip } }, power('chip')), i2cPullUp)).toEqual([
        'SAF-I2C-PULLUP:warning:chip+A4',
        'SAF-I2C-PULLUP:warning:chip+A5',
      ]);
      const withOled = bus(
        { chip: { def: bareChip }, oled: { def: def('display.oled-ssd1306') } },
        power('chip', 'oled'),
      );
      expect(ids(withOled, i2cPullUp)).toEqual([]);
    });

    it('two parts at one address conflict, unless an address pin or reset pins tell them apart', () => {
      const twoImus = (ad0: boolean) =>
        bus({ a: { def: def('sensor.mpu6050') }, b: { def: def('sensor.mpu6050') } }, [
          ...power('a', 'b'),
          ...(ad0 ? ([['src.pos', 'b.ad0']] as const) : []),
        ]);
      expect(ids(twoImus(false), i2cAddress)).toEqual(['SAF-I2C-ADDRESS:error:a+b+A4+A5']);
      expect(analyze(i2cAddress, twoImus(false))[0]?.params).toMatchObject({ address: '0x68' });
      expect(ids(twoImus(true), i2cAddress)).toEqual([]);
      const twoRangers = (xshut: boolean) => ({
        ...bus({ a: { def: def('sensor.vl53l0x') }, b: { def: def('sensor.vl53l0x') } }, [
          ['src.pos', 'a.vin'],
          ['src.pos', 'b.vin'],
          ...(xshut
            ? ([
                ['mcu.D2', 'a.xshut'],
                ['mcu.D3', 'b.xshut'],
              ] as const)
            : []),
        ]),
        mcuPins: ['A4', 'A5', ...(xshut ? ['D2', 'D3'] : [])],
      });
      expect(ids(twoRangers(false), i2cAddress)).toEqual(['SAF-I2C-ADDRESS:error:a+b+A4+A5']);
      expect(ids(twoRangers(true), i2cAddress)).toEqual([]);
    });

    it('a 3.3 V part on a bus pulled up to 5 V is over its pin rating', () => {
      const mixed = bus({ bmp: { def: def('sensor.bmp280') }, lcd: { def: def('display.lcd1602-i2c') } }, [
        ...power('lcd'),
        ['reg.pos', 'bmp.vcc'],
      ]);
      const spec: CircuitSpec = {
        ...mixed,
        parts: { ...mixed.parts, reg: { def: dcSupply, props: { volts: 3.3, ohms: 0.01 } } },
        ground: [...(mixed.ground ?? []), 'reg.neg'],
      };
      expect(ids(spec, i2cLevel)).toEqual(['SAF-I2C-LEVEL:error:bmp+A4+A5']);
      const alone = bus({ bmp: { def: def('sensor.bmp280') } }, [['reg.pos', 'bmp.vcc']]);
      expect(
        ids(
          {
            ...alone,
            parts: { ...alone.parts, reg: { def: dcSupply, props: { volts: 3.3, ohms: 0.01 } } },
            ground: [...(alone.ground ?? []), 'reg.neg'],
          },
          i2cLevel,
        ),
      ).toEqual([]);
    });
  });
});
