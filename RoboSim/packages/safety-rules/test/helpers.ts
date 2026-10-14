import { UNO_ELECTRICAL, avrUno } from '@robosim/board-avr-uno';
import { findDefinition } from '@robosim/catalog';
import {
  SafetyMonitor,
  analyzeCircuit,
  assembleCircuit,
  instantiateCircuit,
  type BoardInfo,
  type CircuitSpec,
  type Finding,
  type RuntimeRule,
  type Simulation,
  type StaticRule,
} from '@robosim/sim-core';
import { firmware } from '@robosim/test-fixtures';

export const UNO: BoardInfo = {
  pins: avrUno.pins,
  electrical: UNO_ELECTRICAL,
  packageMaxCurrentMa: avrUno.power.mcuPackageMaxCurrentMa,
};

export const def = findDefinition;

/** Runs one static rule on a circuit (US-SAF-01 AC1: fixtures trigger exactly that rule). */
export function analyze(rule: StaticRule, spec: CircuitSpec): Finding[] {
  return analyzeCircuit(assembleCircuit(spec), [rule], UNO);
}

/** Runs firmware on a circuit under the runtime safety monitor. */
export function monitored(spec: CircuitSpec, asm: string, rules: readonly RuntimeRule[]) {
  const circuit = assembleCircuit(spec);
  const sim: Simulation = instantiateCircuit(circuit, {
    mcu: { core: avrUno.createCore(firmware(asm)), electrical: UNO_ELECTRICAL },
  });
  const monitor = new SafetyMonitor(sim, circuit, UNO, rules);
  sim.addObserver(monitor);
  return { sim, monitor, circuit, run: (s: number) => sim.run(Math.round(s * 1000)) };
}

/** Firmware: the given DDRB/PORTB/DDRD/PORTD values, then idle. */
export const ports = ({
  ddrb = 0,
  portb = 0,
  ddrd = 0,
  portd = 0,
}: {
  ddrb?: number;
  portb?: number;
  ddrd?: number;
  portd?: number;
}) => `
    ldi r16, ${ddrb}
    out 0x04, r16
    ldi r16, ${portb}
    out 0x05, r16
    ldi r16, ${ddrd}
    out 0x0a, r16
    ldi r16, ${portd}
    out 0x0b, r16
  halt: rjmp halt
`;
