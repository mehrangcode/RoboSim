import type { AssembledCircuit } from '../circuit.js';
import type { Simulation, SliceContext, SliceObserver } from '../scheduler.js';
import { sortFindings } from './static-analyzer.js';
import type { BoardInfo, Condition, DamageRecord, Finding, PendingCondition, RuntimeRule } from './types.js';

/** Evaluate runtime rules every N slices (5 ms): far finer than any sustain window. */
const DEFAULT_EVERY_SLICES = 5;

/**
 * Runtime safety (FR-SAF-04 / FR-SIM-10): evaluates runtime rules on the live operating point, turns
 * conditions that persist for their sustain window into latched findings, and applies the damage
 * model for Errors. Findings stay latched until the simulation is reset (rebuilt).
 */
export class SafetyMonitor implements SliceObserver {
  private readonly since = new Map<string, number>();
  private readonly latched = new Map<string, Finding>();
  /** Last evaluation per rule, so periodic rules keep their conditions between evaluations. */
  private readonly lastRun = new Map<string, { time: number; conditions: readonly Condition[] }>();
  /** Conditions of the last evaluation that are not latched, by key (for {@link pending}). */
  private open = new Map<string, Condition>();
  private readonly damageListeners: ((r: DamageRecord) => void)[] = [];

  constructor(
    private readonly sim: Simulation,
    private readonly circuit: AssembledCircuit,
    private readonly board: BoardInfo | null,
    private readonly rules: readonly RuntimeRule[],
    private readonly onFinding: (f: Finding) => void = () => undefined,
    private readonly everySlices = DEFAULT_EVERY_SLICES,
  ) {}

  afterSlice(ctx: SliceContext): void {
    if (ctx.slice % this.everySlices !== 0) return;
    const conditions: Condition[] = [];
    for (const rule of this.rules) {
      const last = this.lastRun.get(rule.id);
      if (last && rule.periodS !== undefined && ctx.simTime - last.time < rule.periodS - 1e-9) {
        conditions.push(...last.conditions);
        continue;
      }
      const found = rule.check({
        sim: this.sim,
        circuit: this.circuit,
        board: this.board,
        simTime: ctx.simTime,
        solution: ctx.solution,
      });
      this.lastRun.set(rule.id, { time: ctx.simTime, conditions: found });
      conditions.push(...found);
    }
    const present = new Set<string>();
    const open = new Map<string, Condition>();
    for (const c of conditions) {
      present.add(c.key);
      if (this.latched.has(c.key)) continue;
      const start = this.since.get(c.key) ?? ctx.simTime;
      this.since.set(c.key, start);
      if (ctx.simTime - start + 1e-9 >= c.sustainS) this.latch(c, ctx, start);
      else open.set(c.key, c);
    }
    this.open = open;
    for (const key of [...this.since.keys()]) if (!present.has(key)) this.since.delete(key);
  }

  /**
   * Conditions seen at the last evaluation whose sustain window is still running (TD §18.8). A read: the
   * black box records their parts at full rate until they latch or clear.
   */
  pending(): readonly PendingCondition[] {
    return [...this.open.values()].map((c) => ({
      key: c.key,
      severity: c.severity,
      componentIds: c.componentIds,
      pins: c.pinIds,
      since: this.since.get(c.key) ?? 0,
    }));
  }

  /**
   * Calls `cb` after each latch that applied damage (FR-SIM-16), once per latch. View-only listeners: the
   * damage is already applied when they run. Returns the unsubscribe function.
   */
  onDamage(cb: (r: DamageRecord) => void): () => void {
    this.damageListeners.push(cb);
    return () => {
      const i = this.damageListeners.indexOf(cb);
      if (i >= 0) this.damageListeners.splice(i, 1);
    };
  }

  findings(): Finding[] {
    return sortFindings([...this.latched.values()]);
  }

  private latch(c: Condition, ctx: SliceContext, since: number): void {
    const { key: _key, sustainS: _sustain, damage, ...rest } = c;
    const f: Finding = { ...rest, kind: 'runtime' };
    this.latched.set(c.key, f);
    if (c.severity === 'error' && damage) {
      for (const id of damage.componentIds ?? []) this.sim.damageComponent(id, damage.reason);
      for (const pin of damage.pins ?? []) this.sim.damagePin(pin);
      if (this.damageListeners.length) {
        const record: DamageRecord = {
          slice: ctx.slice,
          simTime: ctx.simTime,
          componentIds: damage.componentIds ?? [],
          pins: damage.pins ?? [],
          reason: damage.reason,
          finding: f,
          conditionKey: c.key,
          conditionSince: since,
          pc: this.sim.mcu?.pc?.() ?? null,
        };
        for (const cb of this.damageListeners) cb(record);
      }
    }
    this.onFinding(f);
  }
}
