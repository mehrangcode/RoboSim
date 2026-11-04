import { BOARD_PART, type ComponentInstance, type ProjectDocument } from '@robosim/shared';
import { describe, expect, it } from 'vitest';
import { blankProject } from './document.js';
import { staticBudget, type Budget } from './power-budget.js';

const part = (id: string, type: string, props: ComponentInstance['props'] = {}): ComponentInstance => ({
  id,
  type,
  typeVersion: '1.0.0',
  x: 0,
  y: 0,
  rotation: 0,
  flipped: false,
  props,
});
const ref = (s: string) => {
  const [part = '', pin = ''] = s.split('.');
  return { part, pin };
};
const doc = (parts: ComponentInstance[], wires: [string, string][] = []): ProjectDocument => ({
  ...blankProject('Test', ''),
  components: parts,
  wires: wires.map(([a, b], i) => ({ id: `w${i + 1}`, from: ref(a), to: ref(b), color: 'red', points: [] })),
});
const B = BOARD_PART;
const source = (b: Budget, key: string) => b.sources.find((s) => s.key === key);
const load = (b: Budget, id: string) => b.loads.find((l) => l.id === id);

describe('staticBudget (FR-SIM-15, TD §18.4)', () => {
  it('sums typical currents of the parts on the board 5 V pin', () => {
    const b = staticBudget(
      doc(
        [part('sonar', 'sensor.hc-sr04'), part('dht', 'sensor.dht11')],
        [
          [`${B}.5V`, 'sonar.vcc'],
          [`${B}.5V`, 'dht.vcc'],
          ['sonar.gnd', `${B}.GND1`],
          ['dht.gnd', `${B}.GND1`],
        ],
      ),
    );
    const rail = source(b, `${B}.5V`);
    expect(rail).toMatchObject({ kind: 'rail', volts: 5, ratingMa: 500, typMa: 15.5, status: 'ok' });
    expect(rail?.loads).toEqual(['sonar', 'dht']);
    expect(load(b, 'sonar')).toMatchObject({ source: `${B}.5V`, typMa: 15, peakMa: 15, duty: 1 });
    expect(source(b, `${B}.3V3`)?.typMa).toBe(0);
  });

  it('chains a linear regulator to its battery and takes the cut-off from it', () => {
    const b = staticBudget(
      doc(
        [
          part('bat', 'power.battery-9v'),
          part('reg', 'semiconductor.lm7805'),
          part('servo', 'actuator.sg90-servo'),
        ],
        [
          ['bat.pos', 'reg.in'],
          ['reg.out', 'servo.vcc'],
          ['servo.gnd', 'reg.gnd'],
          ['reg.gnd', 'bat.neg'],
        ],
      ),
    );
    // A servo is a motor: 50 % duty by default.
    expect(load(b, 'servo')).toMatchObject({ source: 'reg.out', duty: 0.5, typMa: 75 });
    expect(source(b, 'reg.out')).toMatchObject({ kind: 'regulator', parent: 'bat.pos', volts: 5, typMa: 75 });
    // Linear: the input draws the output current plus the quiescent current.
    const bat = source(b, 'bat.pos');
    expect(bat).toMatchObject({ kind: 'battery', typMa: 79.2, cutoffV: 7 });
    expect(bat?.battery).toEqual({ cells: 6, capacityMah: 550, internalOhms: 1.5, charge: 1 });
    expect(bat?.volts).toBeCloseTo(6 * 1.58, 6);
  });

  it('a buck converter draws Vout·Iout / (η·Vin) from its input', () => {
    const b = staticBudget(
      doc(
        [
          part('bat', 'power.battery-9v'),
          part('buck', 'power.lm2596', { outputV: 5 }),
          part('relay', 'actuator.relay-module'),
        ],
        [
          ['bat.pos', 'buck.in+'],
          ['buck.out+', 'relay.vcc'],
        ],
      ),
    );
    const vin = source(b, 'bat.pos')?.volts ?? 0;
    expect(source(b, 'buck.out+')?.typMa).toBe(85);
    expect(source(b, 'bat.pos')?.typMa).toBeCloseTo((5 * 85) / (0.85 * vin) + 5, 6);
    expect(source(b, 'bat.pos')?.cutoffV).toBeCloseTo(6.5, 9); // 5 V + 1.5 V dropout
  });

  it('feeds motors on a driver output from the driver supply, through a power switch', () => {
    const b = staticBudget(
      doc(
        [
          part('pack', 'power.battery-4aa'),
          part('sw', 'power.switch'),
          part('drv', 'driver.tb6612fng'),
          part('mA', 'actuator.tt-motor'),
          part('mB', 'actuator.tt-motor'),
        ],
        [
          ['pack.pos', 'sw.a'],
          ['sw.b', 'drv.vm'],
          [`${B}.5V`, 'drv.vcc'],
          ['drv.ao1', 'mA.m1'],
          ['drv.ao2', 'mA.m2'],
          ['drv.bo1', 'mB.m1'],
          ['drv.bo2', 'mB.m2'],
        ],
      ),
    );
    expect(load(b, 'mA')).toMatchObject({ source: 'pack.pos', via: 'drv', typMa: 75, peakMa: 600 });
    expect(source(b, 'pack.pos')?.typMa).toBeCloseTo(1.5 + 75 + 75, 9);
    expect(source(b, 'pack.pos')?.cutoffV).toBe(3); // the motors' 3 V over the driver's 2.7 V
    expect(load(b, 'sw')).toBeUndefined(); // a conductor, not a load
  });

  it('applies the duty per part and flags supplies over their rating', () => {
    const wires: [string, string][] = [
      [`${B}.5V`, 's1.vcc'],
      [`${B}.5V`, 's2.vcc'],
    ];
    const parts = [part('s1', 'actuator.mg996r-servo'), part('s2', 'actuator.mg996r-servo')];
    const half = staticBudget(doc(parts, wires));
    expect(source(half, `${B}.5V`)).toMatchObject({ typMa: 500, peakMa: 2500, status: 'peakOver' });
    const full = staticBudget(doc(parts, wires), { s1: 1, s2: 1 });
    expect(source(full, `${B}.5V`)).toMatchObject({ typMa: 1000, status: 'over' });
  });

  it('multiplies per-unit currents (an LED strip) and lists parts without a supply pin as unattributed', () => {
    const b = staticBudget(
      doc(
        [
          part('strip', 'actuator.ws2812-strip', { count: 8 }),
          part('led', 'actuator.led'),
          part('r', 'passive.resistor'),
        ],
        [[`${B}.5V`, 'strip.vcc']],
      ),
    );
    expect(load(b, 'strip')).toMatchObject({ typMa: 240, peakMa: 296 });
    expect(load(b, 'led')).toMatchObject({ source: null, typMa: 15 });
    expect(load(b, 'r')).toBeUndefined(); // draws nothing on its own
  });

  it('rates the board 3.3 V pin 50 mA (Arduino spec)', () => {
    const b = staticBudget(doc([part('line', 'sensor.line-5ch')], [[`${B}.3V3`, 'line.vcc']]));
    expect(source(b, `${B}.3V3`)).toMatchObject({ ratingMa: 50, typMa: 75, status: 'over' });
  });

  it('stays under 10 ms at 200 parts', () => {
    const parts: ComponentInstance[] = [];
    const wires: [string, string][] = [];
    for (let i = 0; i < 100; i++) {
      parts.push(part(`s${i}`, 'sensor.hc-sr04'), part(`l${i}`, 'actuator.led'));
      wires.push([`${B}.5V`, `s${i}.vcc`], [`s${i}.gnd`, `${B}.GND1`]);
    }
    const d = doc(parts, wires);
    staticBudget(d);
    const t0 = performance.now();
    for (let k = 0; k < 5; k++) staticBudget(d);
    expect((performance.now() - t0) / 5).toBeLessThan(10);
  });
});
