import type { ProjectDocument } from '@robosim/shared';
import { useCallback, useMemo, useRef, useState } from 'react';
import { commit, redo, startHistory, undo, type History } from './document.js';
import type { Point } from './geometry.js';

export interface Selection {
  readonly parts: readonly string[];
  readonly wire: string | null;
}

export const NO_SELECTION: Selection = { parts: [], wire: null };

/** Editor state shared by the canvas, library and property panes: document history + selection. */
export function useCircuitEditor(initial: ProjectDocument | (() => ProjectDocument)) {
  const [history, setHistory] = useState<History>(() =>
    startHistory(typeof initial === 'function' ? initial() : initial),
  );
  const [selection, setSelection] = useState<Selection>(NO_SELECTION);
  /** Counts whole-document replacements (new / open / import): views re-fit to the new circuit. */
  const [generation, setGeneration] = useState(0);
  /** Centre of the visible canvas (document mm), where library clicks drop new parts. */
  const viewCenterRef = useRef<Point>([60, 30]);

  /** Applies an edit as one undo step. */
  const apply = useCallback((change: (doc: ProjectDocument) => ProjectDocument) => {
    setHistory((h) => commit(h, change(h.present)));
  }, []);
  const reset = useCallback((doc: ProjectDocument) => {
    setHistory(startHistory(doc));
    setSelection(NO_SELECTION);
    setGeneration((g) => g + 1);
  }, []);
  const doUndo = useCallback(() => setHistory(undo), []);
  const doRedo = useCallback(() => setHistory(redo), []);

  return useMemo(
    () => ({
      doc: history.present,
      apply,
      reset,
      undo: doUndo,
      redo: doRedo,
      canUndo: history.past.length > 0,
      canRedo: history.future.length > 0,
      selection,
      setSelection,
      viewCenterRef,
      generation,
    }),
    [history, apply, reset, doUndo, doRedo, selection, generation],
  );
}

export type CircuitEditorState = ReturnType<typeof useCircuitEditor>;
