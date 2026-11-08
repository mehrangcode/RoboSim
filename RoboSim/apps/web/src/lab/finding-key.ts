import type { ConsistencyFinding } from '@robosim/safety-rules/consistency';
import type { FindingView } from '@robosim/sim-runtime/client';

/** A finding of the run (wiring check, runtime) or of the wiring ↔ sketch check while editing. */
export type AnyFinding = FindingView | ConsistencyFinding;

/** Identity of a finding across checks (acknowledging, showing it on the circuit). */
export const findingKey = (f: AnyFinding): string =>
  `${f.kind}:${f.ruleId}:${f.componentIds.join()}:${f.pinIds.join()}`;

/**
 * Message params with part ids replaced by component names (`LED (a)`) and fault codes translated, for
 * the `safety:<rule>.title|why|fix` texts.
 */
export function findingParams(
  f: AnyFinding,
  partTypes: Readonly<Record<string, string>>,
  t: (key: string) => string,
): Record<string, string | number> {
  const name = (id: string): string => partName(id, partTypes, t);
  const out: Record<string, string | number> = { ...f.params };
  for (const key of ['part', 'supply'] as const) if (typeof out[key] === 'string') out[key] = name(out[key]);
  if (typeof out['parts'] === 'string') out['parts'] = out['parts'].split(', ').map(name).join('، ');
  if (typeof out['code'] === 'string') out['code'] = t(`safety:codes.${out['code']}`);
  return out;
}

/** `led1.a` → `LED (a)`; an id without a known type stays as it is. */
export function partName(
  id: string,
  partTypes: Readonly<Record<string, string>>,
  t: (key: string) => string,
): string {
  const [part, pin] = id.split('.');
  const type = partTypes[part ?? ''];
  return type ? `${t(`components:${type}.name`)}${pin ? ` (${pin})` : ''}` : id;
}
