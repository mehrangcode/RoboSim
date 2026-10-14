import { validateManifest, type WheelActuator } from '@robosim/sim-core';
import { bench, dcSupply } from '@robosim/test-fixtures';
import { describe, expect, it } from 'vitest';
import { definition, manifest, motorConstants, type TtMotorProps, type TtMotorState } from './index.js';

const defaults = Object.fromEntries(
  Object.entries(manifest.props).map(([k, v]) => [k, v.default]),
) as unknown as TtMotorProps;

function motorAt(volts: number) {
  const b = bench({
    parts: { src: { def: dcSupply, props: { volts, ohms: 0 } }, m: { def: definition } },
    wires: [['src.pos', 'm.m1']],
    ground: ['src.neg', 'm.m2'],
  });
  return b;
}

describe('actuator.tt-motor', () => {
  it('has a valid manifest', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('derives constants that reproduce the datasheet points', () => {
    const k = motorConstants(defaults);
    expect(k.r).toBeCloseTo(5, 9); // 6 V / 1.2 A
    const omega0 = ((250 * 2 * Math.PI) / 60) * 48;
    expect((6 - k.ke * omega0) / k.r).toBeCloseTo(0.15, 9); // no-load current
    expect((k.j * k.r) / (k.ke * k.ke)).toBeCloseTo(0.03, 9); // mechanical time constant
  });

  it('spins up to the rated no-load speed with a ~τ first-order response', () => {
    const b = motorAt(6);
    b.run(0.03);
    const early = b.state<TtMotorState>('m').rpm;
    expect(early / 250).toBeGreaterThan(0.55); // 1 − e^-1 ≈ 0.63
    expect(early / 250).toBeLessThan(0.7);
    b.run(0.5);
    const s = b.state<TtMotorState>('m');
    expect(s.rpm).toBeCloseTo(250, 0);
    expect(s.currentMa).toBeCloseTo(150, 0);
  });

  it('runs at half speed on half voltage and reverses with polarity', () => {
    const half = motorAt(3);
    half.run(0.5);
    expect(half.state<TtMotorState>('m').rpm).toBeGreaterThan(105);
    expect(half.state<TtMotorState>('m').rpm).toBeLessThan(125);
    const rev = motorAt(-6);
    rev.run(0.5);
    expect(rev.state<TtMotorState>('m').rpm).toBeCloseTo(-250, 0);
  });

  it('draws stall current when held and slows under load', () => {
    const b = motorAt(6);
    b.input('m', 'stalled', true);
    b.run(0.01);
    expect(b.state<TtMotorState>('m')).toMatchObject({ rpm: 0 });
    expect(b.state<TtMotorState>('m').currentMa).toBeCloseTo(1200, 3);

    const loaded = motorAt(6);
    loaded.input('m', 'loadTorqueNm', 0.05); // ~0.05 N·m at the wheel
    loaded.run(0.5);
    const s = loaded.state<TtMotorState>('m');
    expect(s.rpm).toBeLessThan(230);
    expect(s.currentMa).toBeGreaterThan(300);
    expect(s.torqueNm).toBeCloseTo(0.05, 2);
  });
});

describe('actuator.tt-motor as a wheel actuator', () => {
  it('delivers stall torque at standstill and follows the imposed shaft speed', () => {
    const b = motorAt(6);
    const motor = b.models['m'] as unknown as WheelActuator;
    motor.setShaftSpeed(0);
    b.run(0.002);
    const k = motorConstants(defaults);
    expect(motor.shaftTorque()).toBeCloseTo(k.ke * 1.2 * 48 * 0.75, 6); // Kt·I_stall·G·η
    expect(motor.shaftInertia).toBeCloseTo(k.j * 48 * 48, 12);

    const noLoad = (250 * 2 * Math.PI) / 60;
    motor.setShaftSpeed(noLoad);
    b.run(0.002);
    expect(b.state<TtMotorState>('m').rpm).toBeCloseTo(250, 6); // speed is imposed, not integrated
    expect(b.state<TtMotorState>('m').currentMa).toBeCloseTo(150, 0);
    expect(motor.shaftTorque()).toBeCloseTo(0, 6); // Kt·I0 just balances friction
  });
});
