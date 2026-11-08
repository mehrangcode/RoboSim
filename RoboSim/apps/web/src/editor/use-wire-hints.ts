import {
  loadWireConvention,
  saveWireConvention,
  wireHints,
  type WireConvention,
  type WireHint,
} from '@robosim/circuit-canvas';
import type { ProjectDocument } from '@robosim/shared';
import { useCallback, useEffect, useState } from 'react';

/** Wiring hints (FR-CIR-11) of the edited circuit, recomputed 300 ms after the last edit (TD §18.7). */
export function useWireHints(doc: ProjectDocument, conv: WireConvention): readonly WireHint[] {
  const [hints, setHints] = useState<readonly WireHint[]>(() => wireHints(doc, conv));
  useEffect(() => {
    const timer = setTimeout(() => setHints(wireHints(doc, conv)), 300);
    return () => clearTimeout(timer);
  }, [doc, conv]);
  return hints;
}

/** The wire colour convention, saved in this browser (`robosim.wireConvention.v1`). */
export function useWireConvention(): [WireConvention, (conv: WireConvention) => void] {
  const [conv, setConv] = useState(loadWireConvention);
  const change = useCallback((next: WireConvention) => {
    saveWireConvention(next);
    setConv(next);
  }, []);
  return [conv, change];
}

const dismissedKey = (project: string) => `robosim.wireHints.dismissed.v1.${project}`;

function loadDismissed(project: string): ReadonlySet<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(dismissedKey(project)) ?? '[]') as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Hints dismissed in a project (by hint key), kept in this browser. */
export function useDismissedHints(project: string) {
  const [state, setState] = useState(() => ({ project, keys: loadDismissed(project) }));
  // Another project opened in the same editor: its own list.
  const keys = state.project === project ? state.keys : loadDismissed(project);
  if (state.project !== project) setState({ project, keys });
  const update = useCallback(
    (next: ReadonlySet<string>) => {
      try {
        localStorage.setItem(dismissedKey(project), JSON.stringify([...next]));
      } catch {
        // Storage blocked: dismissed for this session only.
      }
      setState({ project, keys: next });
    },
    [project],
  );
  return {
    dismissed: keys,
    dismiss: (key: string) => update(new Set([...keys, key])),
    restore: (key: string) => update(new Set([...keys].filter((k) => k !== key))),
  };
}
