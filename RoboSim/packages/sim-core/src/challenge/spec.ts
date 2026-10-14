/**
 * Declarative success conditions (Technical Design §5.7, FR-ARN-11): plain JSON, evaluated every few
 * milliseconds of simulated time. No user code ever runs on the server.
 */

export type GoalSpec =
  /** Robot axle midpoint enters the zone. */
  | { readonly type: 'reachZone'; readonly zone: string }
  /** Every checkpoint zone of the arena in order, then back into the start zone — `count` times. */
  | { readonly type: 'laps'; readonly count: number }
  | { readonly type: 'checkpointsInOrder'; readonly zones: readonly string[] }
  /** Regex over the serial output (bounded: ≤ 200 chars, no nested quantifiers, last 4 KB of output). */
  | { readonly type: 'serialMatches'; readonly pattern: string; readonly ignoreCase?: boolean }
  /** An MCU output pin holds `level` for at least `forS` seconds. */
  | { readonly type: 'pinState'; readonly pin: string; readonly level: 0 | 1; readonly forS?: number }
  /** A movable arena object leaves the zone (sumo ring). */
  | { readonly type: 'pushOut'; readonly object: string; readonly zone: string };

export type ConstraintSpec =
  | { readonly type: 'timeLimit'; readonly seconds: number }
  /** At most `tolerance` contacts between the robot and walls/obstacles. */
  | { readonly type: 'noCollision'; readonly tolerance: number }
  /** Share of the run with the line under the robot (judged when the run is decided). */
  | { readonly type: 'onLineRatio'; readonly min: number };

export type ConditionSpec =
  | GoalSpec
  | ConstraintSpec
  | { readonly all: readonly ConditionSpec[] }
  | { readonly any: readonly ConditionSpec[] }
  | { readonly not: ConditionSpec };

export type ScoreTerm =
  | { readonly type: 'laps'; readonly weight: number }
  | { readonly type: 'checkpoints'; readonly weight: number }
  /** Full points at or under `under` seconds, falling linearly to zero at the time limit. Only on success. */
  | { readonly type: 'timeBonus'; readonly under: number; readonly weight: number }
  | { readonly type: 'onLineRatio'; readonly weight: number }
  | { readonly type: 'noCollision'; readonly weight: number };

export interface ChallengeSpec {
  readonly id: string;
  readonly condition: ConditionSpec;
  readonly score?: readonly ScoreTerm[];
}

export const SERIAL_PATTERN_MAX = 200;

/** Rejects patterns with a quantified group that itself contains a quantifier — the classic ReDoS shape. */
export function isSafePattern(pattern: string): boolean {
  if (pattern.length > SERIAL_PATTERN_MAX) return false;
  if (/\((?:[^()\\]|\\.)*[*+}](?:[^()\\]|\\.)*\)\s*[*+{]/.test(pattern)) return false;
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

/** Structural validation against the arena's zones and objects; returns human-readable problems. */
export function validateChallenge(
  spec: ChallengeSpec,
  arena: { zones: readonly { id: string; kind: string }[]; objects: readonly string[] },
): string[] {
  const errors: string[] = [];
  const zoneIds = new Set(arena.zones.map((z) => z.id));
  const positive = (v: number, what: string) => {
    if (!(Number.isFinite(v) && v > 0)) errors.push(`${what} must be > 0`);
  };
  const visit = (c: ConditionSpec, path: string): void => {
    if ('all' in c || 'any' in c) {
      const list = 'all' in c ? c.all : c.any;
      if (list.length === 0) errors.push(`${path}: empty ${'all' in c ? 'all' : 'any'}`);
      list.forEach((child, i) => visit(child, `${path}.${'all' in c ? 'all' : 'any'}[${i}]`));
      return;
    }
    if ('not' in c) {
      visit(c.not, `${path}.not`);
      return;
    }
    switch (c.type) {
      case 'reachZone':
        if (!zoneIds.has(c.zone)) errors.push(`${path}: unknown zone '${c.zone}'`);
        break;
      case 'laps':
        positive(c.count, `${path}.count`);
        if (
          !arena.zones.some((z) => z.kind === 'start') ||
          !arena.zones.some((z) => z.kind === 'checkpoint')
        ) {
          errors.push(`${path}: laps need a start zone and checkpoint zones in the arena`);
        }
        break;
      case 'checkpointsInOrder':
        if (c.zones.length === 0) errors.push(`${path}: no zones`);
        for (const z of c.zones) if (!zoneIds.has(z)) errors.push(`${path}: unknown zone '${z}'`);
        break;
      case 'serialMatches':
        if (!isSafePattern(c.pattern)) errors.push(`${path}: unsafe or invalid pattern`);
        break;
      case 'pinState':
        if (!/^[AD]\d{1,2}$/.test(c.pin)) errors.push(`${path}: bad pin '${c.pin}'`);
        break;
      case 'pushOut':
        if (!zoneIds.has(c.zone)) errors.push(`${path}: unknown zone '${c.zone}'`);
        if (!arena.objects.includes(c.object)) errors.push(`${path}: unknown object '${c.object}'`);
        break;
      case 'timeLimit':
        positive(c.seconds, `${path}.seconds`);
        break;
      case 'noCollision':
        if (!(Number.isInteger(c.tolerance) && c.tolerance >= 0))
          errors.push(`${path}.tolerance must be an integer ≥ 0`);
        break;
      case 'onLineRatio':
        if (!(c.min >= 0 && c.min <= 1)) errors.push(`${path}.min must be within 0..1`);
        break;
    }
  };
  visit(spec.condition, 'condition');
  for (const [i, t] of (spec.score ?? []).entries()) {
    if (!(t.weight >= 0)) errors.push(`score[${i}].weight must be ≥ 0`);
    if (t.type === 'timeBonus') positive(t.under, `score[${i}].under`);
  }
  return errors;
}
