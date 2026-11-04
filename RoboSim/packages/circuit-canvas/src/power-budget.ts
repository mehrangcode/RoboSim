import { findManifest, type ComponentManifest } from '@robosim/catalog/manifests';
import { BATTERY_CELLS, cellOcv } from '@robosim/component-battery';
import { BOARD_PART, type ComponentInstance, type PinRef, type ProjectDocument } from '@robosim/shared';
import { CircuitNets } from './nets.js';

/** A supply output: the board's 5 V / 3.3 V pin, a battery, or a regulator's output. */
export interface BudgetSource {
  /** `part.pin` of the output, e.g. `board.5V`, `bat.pos`, `reg.out`. */
  readonly key: string;
  readonly part: string;
  readonly pin: string;
  readonly kind: 'rail' | 'battery' | 'regulator';
  /** Nominal output voltage (a battery: its open-circuit voltage at the set charge). */
  readonly volts: number;
  readonly ratingMa: number;
  /** The source a regulator draws from (null: a root, or an input wired to nothing). */
  readonly parent: string | null;
  /** Parts drawing directly from this output (regulators and drivers included). */
  readonly loads: readonly string[];
  /** Typical and pessimistic draw (mA), downstream regulators included. */
  readonly typMa: number;
  readonly peakMa: number;
  readonly status: BudgetStatus;
  /** Batteries: the highest working voltage among what they power, directly or through regulators. */
  readonly cutoffV?: number;
  readonly battery?: {
    readonly cells: number;
    readonly capacityMah: number;
    readonly internalOhms: number;
    readonly charge: number;
  };
}

/** `over`: typical draw above the rating (an Error); `peakOver`: only the peak is (a Warning). */
export type BudgetStatus = 'ok' | 'peakOver' | 'over';

export interface BudgetLoad {
  readonly id: string;
  readonly type: string;
  /** The supply it draws from (null: no supply pin wired to a source, e.g. an LED on an MCU pin). */
  readonly source: string | null;
  /** The driver whose output it hangs on (a motor behind a TB6612). */
  readonly via?: string;
  /** Duty 0..1 applied to its typical and peak current. */
  readonly duty: number;
  readonly typMa: number;
  readonly peakMa: number;
  readonly idleMa: number;
  readonly minSupplyV: number;
}

export interface Budget {
  readonly sources: readonly BudgetSource[];
  readonly loads: readonly BudgetLoad[];
}

/** The board's supply pins (TD §18.4): the USB polyfuse behind 5 V; Arduino rates the 3.3 V pin 50 mA. */
const BOARD_SUPPLIES = [
  { pin: '5V', volts: 5, ratingMa: 500 },
  { pin: '3V3', volts: 3.3, ratingMa: 50 },
] as const;

/** Fixed regulator outputs (V); a buck reads its `outputV` prop. */
const REGULATOR_VOLTS: Readonly<Record<string, number>> = {
  'semiconductor.lm7805': 5,
  'semiconductor.ams1117-3v3': 3.3,
  'driver.l298n': 5,
};
/** Switching regulators: they draw Vout·Iout / (η·Vin) instead of Iout. */
const BUCK_TYPES = new Set(['power.lm2596']);
/** Typical buck efficiency at moderate load (TD §5.4: the LM2596 model gives 80–88 %). */
export const BUCK_EFFICIENCY = 0.85;
/** Pins that are one conductor when the part conducts (static: assume a closed switch). */
const PASSTHROUGH: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
  'power.switch': [['a', 'b']],
  'driver.irf520-module': [['vin', 'vplus']],
};

/** Motors run part of the time: 50 % duty by default, everything else 100 % (TD §18.4). */
export const defaultDuty = (type: string): number => (/motor|servo|stepper/.test(type) ? 0.5 : 1);

const limit = (m: ComponentManifest, key: string): number => m.limits[key] ?? 0;
const propOf = (c: ComponentInstance, m: ComponentManifest, key: string): unknown =>
  c.props[key] ?? m.props[key]?.default;

/**
 * Static power budget of a document (FR-SIM-15, TD §18.4): the supply tree from the drawn nets, typical
 * draw from the manifests' `limits.typicalCurrentMa` (× duty, × a per-unit prop) and the pessimistic
 * draw from `peakCurrentMa` (or typical when a part has none). A linear regulator draws its output
 * current plus its quiescent current; a buck Vout·Iout / (η·Vin). Loads on a motor driver's outputs draw
 * from the driver's supply. View-only data: read by no model or rule.
 */
export function staticBudget(doc: ProjectDocument, duty: Readonly<Record<string, number>> = {}): Budget {
  const nets = new CircuitNets(doc);
  // Conducting parts (a closed switch) join their two nets.
  const merged = new Map<string, string>();
  const find = (n: string): string => {
    let r = n;
    while (merged.has(r)) r = merged.get(r) as string;
    return r;
  };
  for (const c of doc.components)
    for (const [a, b] of PASSTHROUGH[c.type] ?? []) {
      const ra = find(nets.netOf({ part: c.id, pin: a }));
      const rb = find(nets.netOf({ part: c.id, pin: b }));
      if (ra !== rb) merged.set(rb, ra);
    }
  const netOf = (pin: PinRef): string => find(nets.netOf(pin));
  const wired = new Set<string>();
  for (const w of doc.wires) wired.add(`${w.from.part}.${w.from.pin}`).add(`${w.to.part}.${w.to.pin}`);
  for (const c of doc.components) for (const pin of Object.keys(c.seats ?? {})) wired.add(`${c.id}.${pin}`);
  const isWired = (part: string, pin: string): boolean =>
    wired.has(`${part}.${pin}`) || nets.connectedTo({ part, pin }).length > 1;

  interface Src {
    key: string;
    part: string;
    pin: string;
    kind: BudgetSource['kind'];
    volts: number;
    ratingMa: number;
    net: string;
    inputNet: string | null;
    buck: boolean;
    cutoffSelfV: number;
    quiescentMa: number;
    battery?: BudgetSource['battery'];
  }
  const sources: Src[] = BOARD_SUPPLIES.map((b) => ({
    key: `${BOARD_PART}.${b.pin}`,
    part: BOARD_PART,
    pin: b.pin,
    kind: 'rail' as const,
    volts: b.volts,
    ratingMa: b.ratingMa,
    net: netOf({ part: BOARD_PART, pin: b.pin }),
    inputNet: null,
    buck: false,
    cutoffSelfV: 0,
    quiescentMa: 0,
  }));
  const parts = doc.components.flatMap((c) => {
    const m = findManifest(c.type);
    return m ? [{ c, m }] : [];
  });
  const supplyPinsOf = (c: ComponentInstance, m: ComponentManifest): Set<string> =>
    new Set(
      (m.supplyPins ?? [])
        .filter((s) => !s.enabledByProp || propOf(c, m, s.enabledByProp) === true)
        .map((s) => s.pin),
    );
  /** The pin a part draws its supply through: its positive polarity pin, else its first power pin. */
  const inputPin = (m: ComponentManifest, supply: Set<string>): string | null => {
    const pos = m.polarity?.[0];
    if (pos && !supply.has(pos) && m.pins.some((p) => p.name === pos && p.kind === 'power')) return pos;
    return m.pins.find((p) => p.kind === 'power' && !supply.has(p.name))?.name ?? null;
  };

  for (const { c, m } of parts) {
    const supply = supplyPinsOf(c, m);
    for (const sp of m.supplyPins ?? []) {
      if (!supply.has(sp.pin)) continue;
      const isBattery = (m.traits ?? []).includes('source');
      const input = isBattery ? null : inputPin(m, supply);
      const outV = BUCK_TYPES.has(c.type)
        ? Number(propOf(c, m, 'outputV') ?? 5)
        : (REGULATOR_VOLTS[c.type] ?? 0);
      const cells = BATTERY_CELLS[c.type] ?? 0;
      const charge = Number(propOf(c, m, 'initialCharge') ?? 1);
      sources.push({
        key: `${c.id}.${sp.pin}`,
        part: c.id,
        pin: sp.pin,
        kind: isBattery ? 'battery' : 'regulator',
        volts: isBattery ? cells * cellOcv(charge) : outV,
        ratingMa: sp.maxCurrentMa,
        net: netOf({ part: c.id, pin: sp.pin }),
        inputNet: input && isWired(c.id, input) ? netOf({ part: c.id, pin: input }) : null,
        buck: BUCK_TYPES.has(c.type),
        cutoffSelfV: Math.max(
          limit(m, 'minSupplyV'),
          m.limits['dropoutV'] !== undefined ? outV + limit(m, 'dropoutV') : 0,
        ),
        quiescentMa: limit(m, 'typicalCurrentMa'),
        ...(isBattery
          ? {
              battery: {
                cells,
                capacityMah: Number(propOf(c, m, 'capacityMah') ?? 0),
                internalOhms: Number(propOf(c, m, 'internalOhms') ?? 0),
                charge,
              },
            }
          : {}),
      });
    }
  }
  const sourceByNet = new Map<string, Src>();
  for (const s of sources) if (!sourceByNet.has(s.net)) sourceByNet.set(s.net, s);

  // Loads: every part with a supply pin on a source net, then what hangs on motor-driver outputs.
  interface Load {
    id: string;
    type: string;
    source: Src | null;
    via?: string;
    duty: number;
    typMa: number;
    peakMa: number;
    idleMa: number;
    minSupplyV: number;
  }
  const loads: Load[] = [];
  const byId = new Map<string, Load>();
  const outputsOf = new Map<string, { driver: string; source: Src | null }>();
  for (const { c, m } of parts) {
    if (PASSTHROUGH[c.type]) continue;
    const supply = supplyPinsOf(c, m);
    const pin = inputPin(m, supply);
    const src = pin && isWired(c.id, pin) ? (sourceByNet.get(netOf({ part: c.id, pin })) ?? null) : null;
    const per = m.peakCurrentPer ? Number(propOf(c, m, m.peakCurrentPer) ?? 1) : 1;
    const d = Math.min(1, Math.max(0, duty[c.id] ?? defaultDuty(c.type)));
    const typ = limit(m, 'typicalCurrentMa') * per;
    // A regulator's own draw is its quiescent current; its output loads are added through the tree.
    const isRegulator = sources.some((s) => s.part === c.id && s.kind === 'regulator');
    const load: Load = {
      id: c.id,
      type: c.type,
      source: src,
      duty: d,
      typMa: typ * d,
      peakMa:
        (m.limits['peakCurrentMa'] !== undefined && !isRegulator ? limit(m, 'peakCurrentMa') * per : typ) * d,
      idleMa: limit(m, 'idleCurrentMa') * per,
      minSupplyV: limit(m, 'minSupplyV'),
    };
    if (src || (typ > 0 && !(m.traits ?? []).includes('source'))) {
      loads.push(load);
      byId.set(c.id, load);
    }
    // A motor driver passes its supply to its outputs (TB6612 vm, L298N vs, L9110S vcc).
    if (pin && m.category === 'driver' && m.polarity)
      for (const p of m.pins)
        if (p.kind === 'output' && isWired(c.id, p.name))
          outputsOf.set(netOf({ part: c.id, pin: p.name }), { driver: c.id, source: src });
  }
  // A part without its own supply on a driver output draws through that driver (a motor on a TB6612).
  for (const { c, m } of parts) {
    const load = byId.get(c.id);
    if (!load || load.source) continue;
    for (const p of m.pins) {
      const out = outputsOf.get(netOf({ part: c.id, pin: p.name }));
      if (out && out.driver !== c.id) {
        load.source = out.source;
        load.via = out.driver;
        break;
      }
    }
  }

  // Totals bottom-up: a regulator's output draw becomes its input load.
  const total = new Map<string, { typ: number; peak: number; cutoff: number }>();
  const visiting = new Set<string>();
  const totalOf = (s: Src): { typ: number; peak: number; cutoff: number } => {
    const done = total.get(s.key);
    if (done) return done;
    if (visiting.has(s.key)) return { typ: 0, peak: 0, cutoff: 0 }; // a loop of regulators
    visiting.add(s.key);
    let typ = 0;
    let peak = 0;
    let cutoff = 0;
    for (const l of loads)
      if (l.source === s) {
        typ += l.typMa;
        peak += l.peakMa;
        cutoff = Math.max(cutoff, l.minSupplyV);
      }
    for (const child of sources)
      if (
        child.kind === 'regulator' &&
        child.inputNet !== null &&
        sourceByNet.get(child.inputNet) === s &&
        child !== s
      ) {
        const t = totalOf(child);
        const draw = (ma: number): number =>
          child.buck ? (child.volts * ma) / (BUCK_EFFICIENCY * s.volts) : ma;
        typ += draw(t.typ);
        peak += draw(t.peak);
        cutoff = Math.max(cutoff, child.cutoffSelfV);
      }
    visiting.delete(s.key);
    const out = { typ, peak, cutoff };
    total.set(s.key, out);
    return out;
  };

  return {
    sources: sources.map((s): BudgetSource => {
      const t = totalOf(s);
      const parent = s.inputNet !== null ? (sourceByNet.get(s.inputNet) ?? null) : null;
      return {
        key: s.key,
        part: s.part,
        pin: s.pin,
        kind: s.kind,
        volts: s.volts,
        ratingMa: s.ratingMa,
        parent: parent && parent !== s ? parent.key : null,
        loads: [
          ...loads.filter((l) => l.source === s).map((l) => l.id),
          ...sources
            .filter(
              (c) =>
                c.kind === 'regulator' && c.inputNet !== null && sourceByNet.get(c.inputNet) === s && c !== s,
            )
            .map((c) => c.part),
        ].filter((id, i, all) => all.indexOf(id) === i),
        typMa: t.typ,
        peakMa: t.peak,
        status: t.typ > s.ratingMa ? 'over' : t.peak > s.ratingMa ? 'peakOver' : 'ok',
        ...(s.battery ? { battery: s.battery, cutoffV: t.cutoff } : {}),
      };
    }),
    loads: loads.map((l): BudgetLoad => ({
      id: l.id,
      type: l.type,
      source: l.source?.key ?? null,
      ...(l.via ? { via: l.via } : {}),
      duty: l.duty,
      typMa: l.typMa,
      peakMa: l.peakMa,
      idleMa: l.idleMa,
      minSupplyV: l.minSupplyV,
    })),
  };
}
