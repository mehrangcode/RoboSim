import { describe, expect, it } from 'vitest';
import { def, monitored, ports } from '../../test/helpers.js';
import {
  componentFault,
  floatingInput,
  mcuTotalCurrentRuntime,
  outputsFighting,
  pinCurrentRuntime,
} from './runtime-rules.js';

describe('FR-SAF-04 runtime rules + damage model (FR-SIM-10)', () => {
  it('pin over-current for 50 ms burns the pin; it then stops driving', () => {
    const m = monitored(
      {
        parts: { r: { def: def('passive.resistor'), props: { ohms: 47 } } },
        wires: [['mcu.D13', 'r.a']],
        ground: ['r.b'],
        mcuPins: ['D13'],
      },
      ports({ ddrb: 0x20, portb: 0x20 }),
      [pinCurrentRuntime],
    );
    m.run(0.03);
    expect(m.monitor.findings()).toEqual([]); // not sustained yet
    m.run(0.05);
    expect(m.monitor.findings().map((f) => `${f.severity}:${f.pinIds.join()}`)).toEqual(['error:D13']);
    expect(m.sim.mcuBus?.isPinDamaged('D13')).toBe(true);
    expect(Math.abs(m.sim.mcuBus?.pinCurrent(m.sim.currentSolution, 'D13') ?? 1)).toBe(0);
  });

  it('a 220 Ω LED circuit stays clean', () => {
    const m = monitored(
      {
        parts: {
          r: { def: def('passive.resistor'), props: { ohms: 220 } },
          led: { def: def('actuator.led') },
        },
        wires: [
          ['mcu.D13', 'r.a'],
          ['r.b', 'led.a'],
        ],
        ground: ['led.k'],
        mcuPins: ['D13'],
      },
      ports({ ddrb: 0x20, portb: 0x20 }),
      [pinCurrentRuntime, componentFault],
    );
    m.run(0.3);
    expect(m.monitor.findings()).toEqual([]);
  });

  it('US-SAF-03: D2 and D3 wired together, driven HIGH/LOW → Error, both pins damaged', () => {
    const m = monitored(
      { parts: {}, wires: [['mcu.D2', 'mcu.D3']], mcuPins: ['D2', 'D3'] },
      ports({ ddrd: 0x0c, portd: 0x04 }),
      [outputsFighting],
    );
    m.run(0.05);
    const f = m.monitor.findings();
    expect(f.map((x) => `${x.ruleId}:${x.severity}:${x.pinIds.join('+')}`)).toEqual([
      'SAF-OUTPUTS-FIGHTING:error:D2+D3',
    ]);
    expect(f[0]?.kind).toBe('runtime');
    expect(m.sim.mcuBus?.isPinDamaged('D2')).toBe(true);
    expect(m.sim.mcuBus?.isPinDamaged('D3')).toBe(true);
  });

  it('total MCU current above 200 mA for 100 ms → Error', () => {
    const pins = ['D2', 'D3', 'D4', 'D5', 'D6', 'D7'];
    const m = monitored(
      {
        parts: Object.fromEntries(
          pins.map((p) => [`r${p}`, { def: def('passive.resistor'), props: { ohms: 120 } }]),
        ),
        wires: pins.map((p) => [`mcu.${p}`, `r${p}.a`] as const),
        ground: pins.map((p) => `r${p}.b`),
        mcuPins: pins,
      },
      ports({ ddrd: 0xfc, portd: 0xfc }),
      [mcuTotalCurrentRuntime],
    );
    m.run(0.15);
    expect(m.monitor.findings().map((f) => f.ruleId)).toEqual(['SAF-MCU-TOTAL-CURRENT']);
  });

  it('(9) floating input: plain INPUT with a button to GND warns; INPUT_PULLUP does not', () => {
    const spec = {
      parts: { btn: { def: def('sensor.push-button') } },
      wires: [['btn.b1', 'mcu.D2']] as const,
      ground: ['btn.a1'],
      mcuPins: ['D2'],
    };
    const plain = monitored({ ...spec, wires: [...spec.wires] }, ports({}), [floatingInput]);
    plain.run(0.5);
    expect(plain.monitor.findings().map((f) => `${f.severity}:${f.pinIds.join()}`)).toEqual(['warning:D2']);
    const pulled = monitored({ ...spec, wires: [...spec.wires] }, ports({ portd: 0x04 }), [floatingInput]);
    pulled.run(0.5);
    expect(pulled.monitor.findings()).toEqual([]);
  });

  it('LED without a resistor on a 9 V battery burns out and goes dark', () => {
    const m = monitored(
      {
        parts: { bat: { def: def('power.battery-9v') }, led: { def: def('actuator.led') } },
        wires: [['bat.pos', 'led.a']],
        ground: ['bat.neg', 'led.k'],
      },
      ports({}),
      [componentFault],
    );
    m.run(0.1);
    expect(
      m.monitor.findings().map((f) => `${f.ruleId}:${f.componentIds.join()}:${String(f.params['code'])}`),
    ).toEqual(['SAF-COMPONENT-FAULT:led:OVER_CURRENT']);
    const led = m.sim.model('led')?.snapshot() as { damaged: boolean; currentMa: number };
    expect(led).toMatchObject({ damaged: true, currentMa: 0 });
  });
});
