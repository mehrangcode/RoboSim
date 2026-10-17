import { finding, type Finding, type StaticRule } from '@robosim/sim-core';
import {
  circuitDomains,
  drivableMcuPins,
  groundPin,
  hasTrait,
  netUsers,
  round,
  supplies,
} from '../helpers.js';

const PIN_WARN_MA = 20;
const PIN_ERROR_MA = 40;
const MCU_PIN_ABS_MAX_V = 5.5;
const MCU_PIN_ABS_MIN_V = -0.5;
const REVERSED_V = -0.5;

/** (1) Motor or other inductive load directly on an MCU pin. */
export const inductiveOnPin: StaticRule = {
  id: 'SAF-INDUCTIVE-ON-PIN',
  kind: 'static',
  check({ circuit }) {
    const mcuNets = new Map(circuit.mcuPins.filter((m) => m.net !== 0).map((m) => [m.net, m.pin]));
    const out: Finding[] = [];
    for (const part of circuit.parts.filter((p) => hasTrait(p, 'inductive'))) {
      for (const pin of part.def.manifest.pins.filter((p) => p.kind === 'power')) {
        const mcuPin = mcuNets.get(part.pins[pin.name] ?? -1);
        if (mcuPin) {
          out.push(
            finding({
              ruleId: this.id,
              severity: 'error',
              componentIds: [part.id],
              pinIds: [mcuPin],
              params: { part: part.id, pin: mcuPin },
            }),
          );
        }
      }
    }
    return out;
  },
};

/** (2) LED without series resistance: an LED over its absolute maximum at power-on or with a pin driven. */
export const ledNoResistor: StaticRule = {
  id: 'SAF-LED-NO-RESISTOR',
  kind: 'static',
  check(ctx) {
    const leds = new Set(ctx.circuit.parts.filter((p) => hasTrait(p, 'led')).map((p) => p.id));
    if (leds.size === 0) return [];
    const flagged = new Map<string, string | null>();
    const scan = (faults: readonly { code: string; componentId: string }[], pin: string | null) => {
      for (const f of faults)
        if (f.code === 'OVER_CURRENT' && leds.has(f.componentId) && !flagged.has(f.componentId))
          flagged.set(f.componentId, pin);
    };
    scan(ctx.idle.faults, null);
    for (const { pin } of drivableMcuPins(ctx.circuit)) {
      scan(ctx.drive(pin, 1).faults, pin);
      scan(ctx.drive(pin, 0).faults, pin);
    }
    return [...flagged].map(([id, pin]) =>
      finding({
        ruleId: this.id,
        severity: 'error',
        componentIds: [id],
        pinIds: pin ? [pin] : [],
        params: { part: id },
      }),
    );
  },
};

/** (3) Short circuit between a supply and its own ground. */
export const shortCircuit: StaticRule = {
  id: 'SAF-SHORT-CIRCUIT',
  kind: 'static',
  check({ circuit, idle }) {
    const out: Finding[] = [];
    const seen = new Set<string>();
    for (const s of supplies(circuit)) {
      const gnd = groundPin(s.part);
      const shorted = gnd !== undefined && s.part.pins[gnd] === s.net;
      const faulted = idle.faults.some((f) => f.code === 'SHORT_CIRCUIT' && f.componentId === s.part.id);
      if ((shorted || faulted) && !seen.has(s.part.id)) {
        seen.add(s.part.id);
        out.push(
          finding({
            ruleId: this.id,
            severity: 'error',
            componentIds: [s.part.id],
            pinIds: [],
            params: { part: s.part.id },
          }),
        );
      }
    }
    return out;
  },
};

/** (4) Supply voltage above a component's or MCU pin's absolute maximum. */
export const overvoltage: StaticRule = {
  id: 'SAF-OVERVOLTAGE',
  kind: 'static',
  check({ circuit, idle }) {
    const out: Finding[] = [];
    for (const part of circuit.parts) {
      const m = part.def.manifest;
      const max = m.limits['maxVoltageV'];
      const [pos, neg] = m.polarity ?? [m.pins[0]?.name ?? '', m.pins[1]?.name ?? ''];
      const across = idle.volts(part.pins[pos] ?? 0) - idle.volts(part.pins[neg] ?? 0);
      if (max !== undefined && Math.abs(across) > max) {
        out.push(
          finding({
            ruleId: this.id,
            severity: 'error',
            componentIds: [part.id],
            pinIds: [],
            params: { part: part.id, volts: round(Math.abs(across)), max },
          }),
        );
        continue;
      }
      for (const [pin, limit] of Object.entries(m.pinMaxVolts ?? {})) {
        const v = idle.volts(part.pins[pin] ?? 0) - idle.volts(part.pins[neg] ?? 0);
        if (v > limit) {
          out.push(
            finding({
              ruleId: this.id,
              severity: 'error',
              componentIds: [part.id],
              pinIds: [],
              params: { part: `${part.id}.${pin}`, volts: round(v), max: limit },
            }),
          );
        }
      }
    }
    for (const { pin, net } of circuit.mcuPins) {
      const v = idle.volts(net);
      if (v > MCU_PIN_ABS_MAX_V || v < MCU_PIN_ABS_MIN_V) {
        out.push(
          finding({
            ruleId: this.id,
            severity: 'error',
            componentIds: [],
            pinIds: [pin],
            params: { part: pin, volts: round(v), max: MCU_PIN_ABS_MAX_V },
          }),
        );
      }
    }
    return out;
  },
};

/** (5) Reversed polarity on a polarised supply input. */
export const reversePolarity: StaticRule = {
  id: 'SAF-REVERSE-POLARITY',
  kind: 'static',
  check({ circuit, idle }) {
    return circuit.parts
      .filter((p) => p.def.manifest.polarity)
      .filter((p) => {
        const [pos, neg] = p.def.manifest.polarity ?? ['', ''];
        return idle.volts(p.pins[pos] ?? 0) - idle.volts(p.pins[neg] ?? 0) < REVERSED_V;
      })
      .map((p) =>
        finding({
          ruleId: this.id,
          severity: 'error',
          componentIds: [p.id],
          pinIds: [],
          params: { part: p.id },
        }),
      );
  },
};

/** (6) Worst-case current per MCU pin: > 20 mA Warning, > 40 mA Error. */
export const pinCurrent: StaticRule = {
  id: 'SAF-PIN-CURRENT',
  kind: 'static',
  check(ctx) {
    const out: Finding[] = [];
    for (const { pin } of drivableMcuPins(ctx.circuit)) {
      const ma = Math.max(
        Math.abs(ctx.drive(pin, 1).pinCurrentMa(pin)),
        Math.abs(ctx.drive(pin, 0).pinCurrentMa(pin)),
      );
      if (ma > PIN_WARN_MA) {
        out.push(
          finding({
            ruleId: this.id,
            severity: ma > PIN_ERROR_MA ? 'error' : 'warning',
            componentIds: [],
            pinIds: [pin],
            params: { pin, ma: round(ma), limit: ma > PIN_ERROR_MA ? PIN_ERROR_MA : PIN_WARN_MA },
          }),
        );
      }
    }
    return out;
  },
};

/** (7) Total MCU I/O current could exceed the package limit if every output were on. */
export const mcuTotalCurrent: StaticRule = {
  id: 'SAF-MCU-TOTAL-CURRENT',
  kind: 'static',
  check(ctx) {
    if (!ctx.board) return [];
    let total = 0;
    for (const { pin } of drivableMcuPins(ctx.circuit)) {
      total += Math.max(
        Math.abs(ctx.drive(pin, 1).pinCurrentMa(pin)),
        Math.abs(ctx.drive(pin, 0).pinCurrentMa(pin)),
      );
    }
    return total > ctx.board.packageMaxCurrentMa
      ? [
          finding({
            ruleId: this.id,
            severity: 'warning',
            componentIds: [],
            pinIds: [],
            params: { ma: round(total, 0), limit: ctx.board.packageMaxCurrentMa },
          }),
        ]
      : [];
  },
};

/** (8) Peak draw of everything on a supply output above what that supply can deliver. */
export const supplyOverload: StaticRule = {
  id: 'SAF-SUPPLY-OVERLOAD',
  kind: 'static',
  check({ circuit }) {
    const out: Finding[] = [];
    for (const s of supplies(circuit)) {
      const loads = circuit.parts.filter((p) => {
        if (p.id === s.part.id) return false;
        const pos = p.def.manifest.polarity?.[0];
        const pins = pos ? [pos] : p.def.manifest.pins.filter((x) => x.kind === 'power').map((x) => x.name);
        return pins.some((pin) => p.pins[pin] === s.net);
      });
      const peak = loads.reduce((sum, p) => sum + (p.def.manifest.limits['peakCurrentMa'] ?? 0), 0);
      if (peak > s.maxCurrentMa) {
        out.push(
          finding({
            ruleId: this.id,
            severity: 'error',
            componentIds: [s.part.id, ...loads.map((l) => l.id)],
            pinIds: [],
            params: { supply: `${s.part.id}.${s.pin}`, ma: round(peak, 0), limit: s.maxCurrentMa },
          }),
        );
      }
    }
    return out;
  },
};

/** (10) A supply whose negative terminal is not tied to the common ground. */
export const noCommonGround: StaticRule = {
  id: 'SAF-NO-COMMON-GROUND',
  kind: 'static',
  check({ circuit }) {
    const users = netUsers(circuit);
    const domainOf = circuitDomains(circuit);
    // Nets on the Arduino side: ground and every wired MCU pin.
    const arduino = new Set([domainOf(0), ...circuit.mcuPins.map((m) => domainOf(m.net))]);
    const out: Finding[] = [];
    const seen = new Set<string>();
    for (const s of supplies(circuit)) {
      const gnd = groundPin(s.part);
      const gndNet = gnd === undefined ? undefined : s.part.pins[gnd];
      const inUse = (users.get(s.net)?.length ?? 0) > 1;
      // A fully isolated circuit (behind relay contacts) needs no common ground: nothing crosses over.
      const reachesArduino = arduino.has(domainOf(s.net));
      if (inUse && reachesArduino && gndNet !== undefined && gndNet !== 0 && !seen.has(s.part.id)) {
        seen.add(s.part.id);
        out.push(
          finding({
            ruleId: this.id,
            severity: 'warning',
            componentIds: [s.part.id],
            pinIds: [],
            params: { part: s.part.id },
          }),
        );
      }
    }
    return out;
  },
};

/** (11) Two supply outputs feeding the same rail (back-feeding a regulator or USB). */
export const backfeed: StaticRule = {
  id: 'SAF-BACKFEED',
  kind: 'static',
  check({ circuit }) {
    const byNet = new Map<number, string[]>();
    for (const s of supplies(circuit)) byNet.set(s.net, [...(byNet.get(s.net) ?? []), s.part.id]);
    return [...byNet.values()]
      .filter((ids) => ids.length > 1)
      .map((ids) =>
        finding({
          ruleId: this.id,
          severity: 'error',
          componentIds: ids,
          pinIds: [],
          params: { parts: ids.join(', ') },
        }),
      );
  },
};

/** GA static rules, FR-SAF-02 (1)–(8), (10), (11); (9) floating input is a runtime rule (needs the pin mode). */
export const STATIC_RULES: readonly StaticRule[] = [
  inductiveOnPin,
  ledNoResistor,
  shortCircuit,
  overvoltage,
  reversePolarity,
  pinCurrent,
  mcuTotalCurrent,
  supplyOverload,
  noCommonGround,
  backfeed,
];
