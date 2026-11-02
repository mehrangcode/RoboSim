import type { ConsistencyFinding } from '@robosim/safety-rules/consistency';
import type { FindingView } from '@robosim/sim-runtime/client';

/** A finding of the run (wiring check, runtime) or of the wiring ↔ sketch check while editing. */
export type AnyFinding = FindingView | ConsistencyFinding;

/** Identity of a finding across checks (acknowledging, showing it on the circuit). */
export const findingKey = (f: AnyFinding): string =>
  `${f.kind}:${f.ruleId}:${f.componentIds.join()}:${f.pinIds.join()}`;
