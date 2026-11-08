import type { ProjectDocument } from '@robosim/shared';
import { useCallback, useMemo, useState } from 'react';
import type { CircuitEditorState } from './use-circuit-editor.js';
import { DEFAULT_WIRE_CONVENTION, type WireConvention } from './wire-convention.js';
import { TidyInvariantError, changedWires, tidyScope, tidyWires } from './wire-lint.js';

export interface TidyChoices {
  readonly recolour: boolean;
  readonly reroute: boolean;
  readonly recolourSignals: boolean;
}

const DEFAULT_CHOICES: TidyChoices = { recolour: true, reroute: true, recolourSignals: false };

/**
 * Tidy with preview (FR-CIR-11): `start` takes the selection as scope (its wires, else all) and shows the
 * tidied routes; `apply` commits them as one undo step, `cancel` drops them.
 */
export function useTidy(editor: CircuitEditorState, conv: WireConvention = DEFAULT_WIRE_CONVENTION) {
  const { doc, apply: commit, selection } = editor;
  const [session, setSession] = useState<{ readonly scope: readonly string[] | null } | null>(null);
  const [choices, setChoices] = useState<TidyChoices>(DEFAULT_CHOICES);

  const result = useMemo((): { doc: ProjectDocument; changed: string[] } | 'error' | null => {
    if (!session) return null;
    try {
      const out = tidyWires(doc, { ...choices, wires: session.scope ?? undefined }, conv);
      return { doc: out, changed: changedWires(doc, out) };
    } catch (e) {
      if (e instanceof TidyInvariantError) return 'error';
      throw e;
    }
  }, [session, doc, choices, conv]);

  const start = useCallback(() => setSession({ scope: tidyScope(doc, selection) }), [doc, selection]);
  const cancel = useCallback(() => setSession(null), []);
  const apply = useCallback(() => {
    if (!session) return;
    const opts = { ...choices, wires: session.scope ?? undefined };
    commit((d) => tidyWires(d, opts, conv));
    setSession(null);
  }, [session, choices, conv, commit]);

  return useMemo(
    () => ({
      open: session !== null,
      /** Wires in scope, or null for all of them. */
      scope: session?.scope ?? null,
      choices,
      setChoices,
      preview: result && result !== 'error' ? result.doc : null,
      changed: result && result !== 'error' ? result.changed : [],
      failed: result === 'error',
      start,
      apply,
      cancel,
    }),
    [session, choices, result, start, apply, cancel],
  );
}

export type TidyState = ReturnType<typeof useTidy>;
