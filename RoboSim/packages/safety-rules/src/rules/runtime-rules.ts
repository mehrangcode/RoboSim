import type { Condition, RuntimeRule } from '@robosim/sim-core';
import { round } from '../helpers.js';

const PIN_WARN_A = 0.02;
const PIN_ERROR_A = 0.04;
const FLOATING_OHMS = 10e6;
const DAMAGING_FAULTS = new Set([
  'OVER_CURRENT',
  'SHORT_CIRCUIT',
  'OVER_VOLTAGE',
  'REVERSE_VOLTAGE',
  'OVER_POWER',
]);

const base = (ruleId: string): Pick<Condition, 'ruleId' | 'wireIds' | 'messageKey' | 'learnMoreSlug'> => ({
  ruleId,
  wireIds: [],
  messageKey: `safety:${ruleId}`,
  learnMoreSlug: ruleId.toLowerCase(),
});

/** (6, runtime) Actual pin current: > 40 mA for 50 ms burns the pin; > 20 mA for 200 ms warns. */
export const pinCurrentRuntime: RuntimeRule = {
  id: 'SAF-PIN-CURRENT',
  kind: 'runtime',
  check({ sim, solution }) {
    const bus = sim.mcuBus;
    if (!bus) return [];
    const out: Condition[] = [];
    for (const { pin } of bus.bindings()) {
      const a = Math.abs(bus.pinCurrent(solution, pin));
      if (a <= PIN_WARN_A || bus.isPinDamaged(pin)) continue;
      const error = a > PIN_ERROR_A;
      out.push({
        ...base(this.id),
        key: `${this.id}:${pin}:${error ? 'e' : 'w'}`,
        severity: error ? 'error' : 'warning',
        sustainS: error ? 0.05 : 0.2,
        componentIds: [],
        pinIds: [pin],
        params: { pin, ma: round(a * 1000), limit: error ? 40 : 20 },
        ...(error ? { damage: { pins: [pin], reason: 'pin over-current' } } : {}),
      });
    }
    return out;
  },
};

/** Two MCU outputs on one net driving opposite levels (US-SAF-03): both pins burn after 10 ms. */
export const outputsFighting: RuntimeRule = {
  id: 'SAF-OUTPUTS-FIGHTING',
  kind: 'runtime',
  check({ sim }) {
    const bus = sim.mcuBus;
    if (!bus) return [];
    const byNet = new Map<number, { pin: string; level: number }[]>();
    for (const { pin, net } of bus.bindings()) {
      const o = bus.outputOf(pin);
      if (net === 0 || o?.mode !== 'output' || o.pwm || bus.isPinDamaged(pin)) continue;
      byNet.set(net, [...(byNet.get(net) ?? []), { pin, level: o.level }]);
    }
    const out: Condition[] = [];
    for (const group of byNet.values()) {
      if (group.some((g) => g.level === 1) && group.some((g) => g.level === 0)) {
        const pins = group.map((g) => g.pin);
        out.push({
          ...base(this.id),
          key: `${this.id}:${pins.join('+')}`,
          severity: 'error',
          sustainS: 0.01,
          componentIds: [],
          pinIds: pins,
          params: { pins: pins.join(', ') },
          damage: { pins, reason: 'outputs fighting' },
        });
      }
    }
    return out;
  },
};

/** (7, runtime) Total MCU I/O current above the package limit for 100 ms. */
export const mcuTotalCurrentRuntime: RuntimeRule = {
  id: 'SAF-MCU-TOTAL-CURRENT',
  kind: 'runtime',
  check({ sim, solution, board }) {
    const bus = sim.mcuBus;
    if (!bus || !board) return [];
    const totalMa = bus
      .bindings()
      .reduce((sum, { pin }) => sum + Math.abs(bus.pinCurrent(solution, pin)) * 1000, 0);
    return totalMa > board.packageMaxCurrentMa
      ? [
          {
            ...base(this.id),
            key: this.id,
            severity: 'error',
            sustainS: 0.1,
            componentIds: [],
            pinIds: [],
            params: { ma: round(totalMa, 0), limit: board.packageMaxCurrentMa },
          },
        ]
      : [];
  },
};

/** (9) Input pin without pull-up whose net has no path to any rail (reads noise on real hardware). */
export const floatingInput: RuntimeRule = {
  id: 'SAF-FLOATING-INPUT',
  kind: 'runtime',
  periodS: 0.1,
  check({ sim }) {
    const bus = sim.mcuBus;
    if (!bus) return [];
    const out: Condition[] = [];
    for (const { pin, net } of bus.bindings()) {
      if (bus.outputOf(pin)?.mode !== 'input' || bus.isPinDamaged(pin)) continue;
      if (sim.netResistance(net) > FLOATING_OHMS) {
        out.push({
          ...base(this.id),
          key: `${this.id}:${pin}`,
          severity: 'warning',
          sustainS: 0.2,
          componentIds: [],
          pinIds: [pin],
          params: { pin },
        });
      }
    }
    return out;
  },
};

/** Component-reported faults (LED over-current, short, over-voltage…): sustained 50 ms → that part is damaged. */
export const componentFault: RuntimeRule = {
  id: 'SAF-COMPONENT-FAULT',
  kind: 'runtime',
  check({ sim, circuit }) {
    const out: Condition[] = [];
    for (const part of circuit.parts) {
      for (const f of sim.model(part.id)?.faults() ?? []) {
        if (!DAMAGING_FAULTS.has(f.code)) continue;
        out.push({
          ...base(this.id),
          key: `${this.id}:${part.id}:${f.code}`,
          severity: 'error',
          sustainS: 0.05,
          componentIds: [part.id],
          pinIds: [],
          params: { part: part.id, code: f.code },
          damage: { componentIds: [part.id], reason: f.code },
        });
      }
    }
    return out;
  },
};

export const RUNTIME_RULES: readonly RuntimeRule[] = [
  pinCurrentRuntime,
  outputsFighting,
  mcuTotalCurrentRuntime,
  floatingInput,
  componentFault,
];
