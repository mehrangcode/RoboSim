import {
  finding,
  type AssembledPart,
  type Fault,
  type Finding,
  type NetId,
  type StaticContext,
  type StaticRule,
} from '@robosim/sim-core';
import {
  circuitDomains,
  controlPin,
  drivableMcuPins,
  groundPin,
  hasTrait,
  netUsers,
  round,
  signalGroups,
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
      const peak = loads.reduce((sum, p) => {
        const per = p.def.manifest.peakCurrentPer;
        return sum + (p.def.manifest.limits['peakCurrentMa'] ?? 0) * (per ? Number(p.props[per] ?? 1) : 1);
      }, 0);
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

/**
 * (Tier B) A capacitor connected backwards (electrolytic) or above its voltage rating, at power-on or
 * with a pin driven: read from the part's own faults in the DC probes, where it is open.
 */
export const capacitorStress: StaticRule = {
  id: 'SAF-CAPACITOR',
  kind: 'static',
  check(ctx) {
    const caps = new Set(ctx.circuit.parts.filter((p) => hasTrait(p, 'capacitor')).map((p) => p.id));
    if (caps.size === 0) return [];
    const flagged = new Map<string, { problem: string; volts: number; limit: number; pin: string | null }>();
    const scan = (faults: readonly Fault[], pin: string | null) => {
      for (const f of faults) {
        if (!caps.has(f.componentId) || flagged.has(f.componentId)) continue;
        if (f.code !== 'REVERSE_VOLTAGE' && f.code !== 'OVER_VOLTAGE') continue;
        flagged.set(f.componentId, {
          problem: f.code === 'REVERSE_VOLTAGE' ? 'reversed' : 'overvoltage',
          volts: Number(f.params['volts'] ?? 0),
          limit: Number(f.params['limitV'] ?? 0),
          pin,
        });
      }
    };
    scan(ctx.idle.faults, null);
    for (const { pin } of drivableMcuPins(ctx.circuit)) {
      scan(ctx.drive(pin, 1).faults, pin);
      scan(ctx.drive(pin, 0).faults, pin);
    }
    return [...flagged].map(([id, f]) =>
      finding({
        ruleId: this.id,
        severity: 'error',
        componentIds: [id],
        pinIds: f.pin ? [f.pin] : [],
        params: { part: id, problem: f.problem, volts: round(f.volts), limit: round(f.limit) },
      }),
    );
  },
};

const isSwitch = (p: { def: { manifest: { traits?: readonly string[] } } }) =>
  (p.def.manifest.traits ?? []).some((t) => t === 'bjt' || t === 'mosfet');

/** (Tier B) A BJT base wired straight to an MCU pin: the pin pushes base current with nothing to limit it. */
export const baseNoResistor: StaticRule = {
  id: 'SAF-BASE-NO-RESISTOR',
  kind: 'static',
  check(ctx) {
    const bjts = ctx.circuit.parts.filter((p) => hasTrait(p, 'bjt'));
    if (bjts.length === 0) return [];
    const out: Finding[] = [];
    for (const { pin, net } of drivableMcuPins(ctx.circuit)) {
      const direct = bjts.filter((p) => p.pins['b'] === net);
      if (direct.length === 0) continue;
      const ma = Math.max(
        Math.abs(ctx.drive(pin, 1).pinCurrentMa(pin)),
        Math.abs(ctx.drive(pin, 0).pinCurrentMa(pin)),
      );
      if (ma <= PIN_WARN_MA) continue;
      for (const part of direct)
        out.push(
          finding({
            ruleId: this.id,
            severity: 'error',
            componentIds: [part.id],
            pinIds: [pin],
            params: { part: part.id, pin, ma: round(ma, 0) },
          }),
        );
    }
    return out;
  },
};

/** (Tier B) A MOSFET carrying load with its gate below full enhancement (an IRF520 from a 5 V pin). */
export const mosfetGate: StaticRule = {
  id: 'SAF-MOSFET-GATE',
  kind: 'static',
  check(ctx) {
    const mosfets = new Set(ctx.circuit.parts.filter((p) => hasTrait(p, 'mosfet')).map((p) => p.id));
    if (mosfets.size === 0) return [];
    const flagged = new Map<string, { pin: string | null; vgs: number; needed: number }>();
    const scan = (faults: readonly Fault[], pin: string | null) => {
      for (const f of faults)
        if (f.code === 'PARTIAL_ENHANCEMENT' && mosfets.has(f.componentId) && !flagged.has(f.componentId))
          flagged.set(f.componentId, {
            pin,
            vgs: Number(f.params['vgs'] ?? 0),
            needed: Number(f.params['neededV'] ?? 0),
          });
    };
    scan(ctx.idle.faults, null);
    for (const { pin } of drivableMcuPins(ctx.circuit)) {
      scan(ctx.drive(pin, 1).faults, pin);
      scan(ctx.drive(pin, 0).faults, pin);
    }
    return [...flagged].map(([id, f]) =>
      finding({
        ruleId: this.id,
        severity: 'warning',
        componentIds: [id],
        pinIds: f.pin ? [f.pin] : [],
        params: { part: id, vgs: round(f.vgs), needed: round(f.needed) },
      }),
    );
  },
};

/** Margin above the highest supply (or below ground) that counts as an inductive spike (V). */
const SPIKE_MARGIN_V = 3;

/**
 * (Tier B) A motor or coil switched by a transistor with nothing to carry its current at switch-off:
 * the time-integrated switch-off probe shows the kickback (a diode clamps it to one drop above the supply).
 */
export const flyback: StaticRule = {
  id: 'SAF-FLYBACK',
  kind: 'static',
  check(ctx) {
    const coils = ctx.circuit.parts.filter((p) => hasTrait(p, 'inductive'));
    const switches = ctx.circuit.parts.filter(isSwitch);
    if (coils.length === 0 || switches.length === 0 || !ctx.board) return [];
    const group = signalGroups(ctx.circuit);
    const controls = new Set(
      switches.flatMap((p) => {
        const pin = controlPin(p);
        const net = pin === undefined ? undefined : p.pins[pin];
        return net === undefined || net === 0 ? [] : [group(net)];
      }),
    );
    let ceiling = 0;
    for (let net = 1; net <= ctx.circuit.netCount; net++) ceiling = Math.max(ceiling, ctx.idle.volts(net));
    const flagged = new Map<string, { pin: string; volts: number; switchId: string }>();
    for (const { pin, net } of drivableMcuPins(ctx.circuit)) {
      if (!controls.has(group(net))) continue;
      for (const [from, to] of [
        [1, 0],
        [0, 1],
      ] as const) {
        const probe = ctx.transition(pin, from, to);
        for (const coil of coils) {
          if (flagged.has(coil.id)) continue;
          let volts = 0;
          for (const n of Object.values(coil.pins)) {
            const { min, max } = probe.peak(n);
            if (max > ceiling + SPIKE_MARGIN_V) volts = Math.max(volts, max);
            if (min < -SPIKE_MARGIN_V) volts = Math.max(volts, -min);
          }
          if (volts === 0) continue;
          const coilNets = new Set(Object.values(coil.pins));
          const sw =
            switches.find((s) => Object.values(s.pins).some((n) => n !== 0 && coilNets.has(n))) ??
            switches[0];
          flagged.set(coil.id, { pin, volts, switchId: sw?.id ?? '' });
        }
      }
    }
    return [...flagged].map(([id, f]) =>
      finding({
        ruleId: this.id,
        severity: 'error',
        componentIds: [id, f.switchId].filter((x) => x !== ''),
        pinIds: [f.pin],
        params: { part: id, pin: f.pin, volts: round(f.volts, 0), switch: f.switchId },
      }),
    );
  },
};

/** An I²C part with its bus nets, supply and the address it answers at power-on. */
interface I2cPart {
  readonly part: AssembledPart;
  readonly sda: NetId;
  readonly scl: NetId;
  readonly vcc: number;
  readonly gnd: NetId;
  readonly address: number;
}

/** I²C parts on the circuit, with idle-probe supply voltages and their power-on addresses. */
function i2cParts(ctx: StaticContext): I2cPart[] {
  const out: I2cPart[] = [];
  for (const part of ctx.circuit.parts) {
    const spec = part.def.manifest.i2c;
    if (!spec) continue;
    const sda = part.pins[spec.sda];
    const scl = part.pins[spec.scl];
    if (sda === undefined || scl === undefined || sda === 0 || scl === 0) continue;
    const gnd = part.pins[groundPin(part) ?? ''] ?? 0;
    const rel = (net: NetId | undefined) =>
      net === undefined ? 0 : ctx.idle.volts(net) - ctx.idle.volts(gnd);
    const vcc = rel(part.pins[part.def.manifest.polarity?.[0] ?? '']);
    let address = spec.address;
    const prop = spec.addressProp ? part.props[spec.addressProp] : undefined;
    if (typeof prop === 'string') address = Number.parseInt(prop, 16);
    if (spec.addressPin && rel(part.pins[spec.addressPin.pin]) > vcc / 2) address = spec.addressPin.whenHigh;
    out.push({ part, sda, scl, vcc, gnd, address });
  }
  return out;
}

/** Board pins on a bus line (A4/A5 on the Uno), for highlighting. */
const mcuPinsOn = (ctx: StaticContext, nets: readonly NetId[]): string[] =>
  ctx.circuit.mcuPins.filter((m) => nets.includes(m.net)).map((m) => m.pin);

const hex = (a: number): string => `0x${a.toString(16).toUpperCase().padStart(2, '0')}`;

/** A line idling below this has no pull-up (floats or is held low); modules pull up to 3.3 or 5 V. */
const NO_PULLUP_V = 1.5;
const POWERED_V = 1.5;

/** (Tier C) An I²C line with no pull-up: it idles low or floats, so nothing can signal on it. */
export const i2cPullUp: StaticRule = {
  id: 'SAF-I2C-PULLUP',
  kind: 'static',
  check(ctx) {
    const out: Finding[] = [];
    const seen = new Set<NetId>();
    for (const d of i2cParts(ctx)) {
      if (d.vcc < POWERED_V) continue;
      for (const [line, net] of [
        ['SDA', d.sda],
        ['SCL', d.scl],
      ] as const) {
        const volts = ctx.idle.volts(net) - ctx.idle.volts(d.gnd);
        if (seen.has(net) || volts >= NO_PULLUP_V) continue;
        seen.add(net);
        out.push(
          finding({
            ruleId: this.id,
            severity: 'warning',
            componentIds: [d.part.id],
            pinIds: mcuPinsOn(ctx, [net]),
            params: { part: d.part.id, line, volts: round(volts) },
          }),
        );
      }
    }
    return out;
  },
};

/** (Tier C) Two parts answering the same address on one bus: both drive their replies at once. */
export const i2cAddress: StaticRule = {
  id: 'SAF-I2C-ADDRESS',
  kind: 'static',
  check(ctx) {
    const mcuNets = new Set(ctx.circuit.mcuPins.map((m) => m.net));
    const resettable = (d: I2cPart) => {
      const pin = d.part.def.manifest.i2c?.resetPin;
      const net = pin ? d.part.pins[pin] : undefined;
      return net !== undefined && net !== 0 && mcuNets.has(net);
    };
    const buses = new Map<string, I2cPart[]>();
    for (const d of i2cParts(ctx)) {
      const key = `${d.sda}:${d.scl}:${d.address}`;
      buses.set(key, [...(buses.get(key) ?? []), d]);
    }
    const out: Finding[] = [];
    for (const parts of buses.values()) {
      // Parts the firmware can hold in reset get their own address one by one; one may keep the default.
      if (parts.length < 2 || parts.filter((d) => !resettable(d)).length <= 1) continue;
      const [first] = parts as [I2cPart, ...I2cPart[]];
      out.push(
        finding({
          ruleId: this.id,
          severity: 'error',
          componentIds: parts.map((d) => d.part.id),
          pinIds: mcuPinsOn(ctx, [first.sda, first.scl]),
          params: { parts: parts.map((d) => d.part.id).join(', '), address: hex(first.address) },
        }),
      );
    }
    return out;
  },
};

/** (Tier C) A 3.3 V-only part on a bus pulled up to more than its pins tolerate (5 V pull-ups). */
export const i2cLevel: StaticRule = {
  id: 'SAF-I2C-LEVEL',
  kind: 'static',
  check(ctx) {
    const out: Finding[] = [];
    for (const d of i2cParts(ctx)) {
      const limit = d.part.def.manifest.i2c?.maxBusV;
      if (limit === undefined) continue;
      const volts = Math.max(ctx.idle.volts(d.sda), ctx.idle.volts(d.scl)) - ctx.idle.volts(d.gnd);
      if (volts <= limit + LEVEL_MARGIN_V) continue;
      out.push(
        finding({
          ruleId: this.id,
          severity: 'error',
          componentIds: [d.part.id],
          pinIds: mcuPinsOn(ctx, [d.sda, d.scl]),
          params: { part: d.part.id, volts: round(volts), limit },
        }),
      );
    }
    return out;
  },
};

/** I/O pins tolerate their supply + 0.3 V (absolute maximum ratings). */
const LEVEL_MARGIN_V = 0.3;

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
  capacitorStress,
  baseNoResistor,
  mosfetGate,
  flyback,
  i2cPullUp,
  i2cAddress,
  i2cLevel,
];
