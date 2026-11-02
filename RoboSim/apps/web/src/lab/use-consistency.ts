import { boardPinView } from '@robosim/circuit-canvas';
import { checkConsistency, type ConsistencyFinding } from '@robosim/safety-rules/consistency';
import type { ProjectDocument } from '@robosim/shared';
import { useMemo } from 'react';
import { useCodeFacts } from './use-code-facts.js';

const NONE: readonly ConsistencyFinding[] = [];

/**
 * Wiring ↔ sketch findings (FR-SAF-08) of the project as it is being edited: the circuit side updates on
 * every edit, the code side 300 ms after typing stops (US-SAF-06 AC4). Empty while the parser loads.
 */
export function useConsistency(
  doc: ProjectDocument,
  files: readonly { readonly name: string; readonly content: string }[],
): readonly ConsistencyFinding[] {
  const hasCode = files.some((f) => f.content.trim().length > 0);
  const code = useCodeFacts(files, hasCode);
  const pins = useMemo(() => boardPinView(doc), [doc]);
  return useMemo(() => (hasCode && code ? checkConsistency(pins, code) : NONE), [hasCode, pins, code]);
}
