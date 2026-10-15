import { UNO_ELECTRICAL } from '@robosim/board-avr-uno';
import { dmath, type ArenaSpec, type ChallengeResult, type NodeView } from '@robosim/sim-core';
import type { ChallengeView, Damage, HotFrame, PinView } from './protocol.js';
import type { Scenario } from './scenarios.js';

/*
 * Views of a running scenario shared by the worker host (snapshots) and the grader (traces), so a
 * verified run and the live run it checks describe the same state the same way.
 */

export function pinViews(s: Scenario): Record<string, PinView> {
  const core = s.circuit.sim.mcu;
  if (!core) throw new Error('scenario has no MCU');
  const outputs = core.pinOutputs();
  const solution = s.circuit.sim.currentSolution;
  const views: Record<string, PinView> = {};
  for (const pin of s.scene.pins) {
    const o = outputs.get(pin);
    if (!o) continue;
    const volts = solution.voltage(s.circuit.net(`mcu.${pin}`));
    // Inputs show what the MCU reads (Uno VIH 3 V / VIL 1.5 V); in-between keeps the driven bit.
    const level =
      o.mode === 'output'
        ? o.level
        : volts >= UNO_ELECTRICAL.vih
          ? 1
          : volts <= UNO_ELECTRICAL.vil
            ? 0
            : o.level;
    views[pin] = o.pwm
      ? { mode: o.mode, level, volts, duty: o.pwm.dutyRatio }
      : { mode: o.mode, level, volts };
  }
  return views;
}

export function robotView(s: Scenario): NonNullable<HotFrame['robot']> {
  const body = s.world?.bodies()[0];
  const ls = s.lineSensor;
  const pose = ls ? s.world?.componentPose(ls.id) : null;
  const line = ls
    ? (s.circuit.models[ls.id]?.snapshot() as { outputs?: Record<string, 0 | 1> } | undefined)
    : undefined;
  const sensors =
    pose && ls
      ? (['left', 'center', 'right'] as const).map((ch, i) => {
          const y = (1 - i) * ls.spacingMm * 1e-3;
          return {
            x: pose.position.x - dmath.sin(pose.angle) * y,
            y: pose.position.y + dmath.cos(pose.angle) * y,
            black: line?.outputs?.[ch] === 1,
          };
        })
      : [];
  return { x: body?.position.x ?? 0, y: body?.position.y ?? 0, angle: body?.angle ?? 0, sensors };
}

/** Damaged parts and MCU pins (FR-SIM-10). */
export function damageView(s: Scenario): Damage {
  const sim = s.circuit.sim;
  return {
    parts: sim
      .snapshot()
      .components.filter((c) => (c.state as { damaged?: boolean } | null)?.damaged === true)
      .map((c) => c.id),
    pins: s.scene.pins.filter((p) => sim.mcuBus?.isPinDamaged(p)),
  };
}

function findNode(n: NodeView, type: string): NodeView | null {
  if (n.type === type) return n;
  for (const c of n.children ?? []) {
    const hit = findNode(c, type);
    if (hit) return hit;
  }
  return null;
}

export function challengeView(r: ChallengeResult, arena: ArenaSpec | null): ChallengeView {
  const zones = arena?.zones ?? [];
  const checkpoints = zones.filter((z) => z.kind === 'checkpoint').map((z) => z.id);
  const start = zones.find((z) => z.kind === 'start')?.id ?? null;
  const laps = findNode(r.tree, 'laps');
  const index = Number(laps?.params['checkpoint'] ?? 0);
  const done = laps?.status === 'met';
  return {
    id: r.challengeId,
    status: r.status,
    decidedAt: r.decidedAt,
    tree: r.tree,
    score: r.score
      ? {
          total: r.score.total,
          max: r.score.max,
          lines: r.score.lines.map((l) => ({ type: l.type, weight: l.weight, points: l.points })),
        }
      : null,
    visitedZones: done ? [...checkpoints] : checkpoints.slice(0, index),
    nextZone: done ? null : (checkpoints[index] ?? start),
  };
}
