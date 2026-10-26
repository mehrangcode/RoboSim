import type { GuidedProgress } from '@robosim/shared';
import { use, useCallback, useEffect, useState } from 'react';
import { AuthContext } from '../auth/use-auth.js';
import type { LearningClient } from '../lib/learning-api.js';

/** Progress of one guided project: steps completed at least once, completion, and the project it lives in. */
export interface ProgressEntry {
  readonly completedSteps: readonly string[];
  readonly completedAt: string | null;
  readonly projectId: string | null;
}
export type ProgressMap = Readonly<Record<string, ProgressEntry>>;

/** A guest's progress in this browser, by `slug@version`; moved to the account on sign-in (like owned parts). */
const GUEST_KEY = 'robosim.guided.v1';

export function loadGuestProgress(): ProgressMap {
  try {
    const parsed = JSON.parse(localStorage.getItem(GUEST_KEY) ?? '{}') as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, Partial<ProgressEntry>>).map(([id, e]) => [
        id,
        {
          completedSteps: Array.isArray(e.completedSteps)
            ? e.completedSteps.filter((s) => typeof s === 'string')
            : [],
          completedAt: typeof e.completedAt === 'string' ? e.completedAt : null,
          projectId: null,
        },
      ]),
    );
  } catch {
    return {};
  }
}

function saveGuestProgress(progress: ProgressMap | null): void {
  try {
    if (progress && Object.keys(progress).length) localStorage.setItem(GUEST_KEY, JSON.stringify(progress));
    else localStorage.removeItem(GUEST_KEY);
  } catch {
    // storage disabled: progress lasts for this visit
  }
}

const entryOf = (p: GuidedProgress): ProgressEntry => ({
  completedSteps: p.completedSteps,
  completedAt: p.completedAt,
  projectId: p.projectId,
});

export interface GuidedProgressState {
  /** Null while the account's progress loads. */
  readonly progress: ProgressMap | null;
  /** Records newly completed steps (and completion); does nothing when nothing is new. */
  record(id: string, steps: readonly string[], completed: boolean, projectId?: string | null): void;
  readonly saveFailed: boolean;
}

/** The learner's guided-project progress: the account's when signed in, this browser's otherwise. */
export function useGuidedProgress(client: LearningClient): GuidedProgressState {
  const userId = use(AuthContext)?.me?.id ?? null;
  const [progress, setProgress] = useState<ProgressMap | null>(() => (userId ? null : loadGuestProgress()));
  const [saveFailed, setSaveFailed] = useState(false);
  // Signing in or out swaps whose progress is shown; the account's arrives from the effect below.
  const [shownFor, setShownFor] = useState(userId);
  if (shownFor !== userId) {
    setShownFor(userId);
    setProgress(userId ? null : loadGuestProgress());
  }

  useEffect(() => {
    if (!userId) return;
    let live = true;
    void (async () => {
      try {
        const guest = loadGuestProgress();
        for (const [id, e] of Object.entries(guest)) {
          await client
            .putProgress(id, { completedSteps: [...e.completedSteps], completed: e.completedAt !== null })
            .catch(() => undefined); // content the account's plan does not open stays behind
        }
        saveGuestProgress(null);
        const rows = await client.progress();
        if (live) setProgress(Object.fromEntries(rows.map((r) => [r.contentVersionId, entryOf(r)])));
      } catch {
        if (live) {
          setProgress({});
          setSaveFailed(true);
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [client, userId]);

  const record = useCallback(
    (id: string, steps: readonly string[], completed: boolean, projectId?: string | null) => {
      const before = progress?.[id];
      const known = new Set(before?.completedSteps ?? []);
      const added = steps.filter((s) => !known.has(s));
      const finishing = completed && !before?.completedAt;
      const linking = projectId !== undefined && projectId !== (before?.projectId ?? null);
      if (!progress || (!added.length && !finishing && !linking)) return;
      const entry: ProgressEntry = {
        completedSteps: [...known, ...added],
        completedAt: before?.completedAt ?? (completed ? new Date().toISOString() : null),
        projectId: projectId === undefined ? (before?.projectId ?? null) : projectId,
      };
      const next = { ...progress, [id]: entry };
      setProgress(next);
      if (!userId) return saveGuestProgress(next);
      client
        .putProgress(id, {
          completedSteps: [...entry.completedSteps],
          completed,
          ...(projectId !== undefined ? { projectId } : {}),
        })
        .then(
          (row) => {
            setSaveFailed(false);
            setProgress((p) => ({ ...p, [id]: entryOf(row) }));
          },
          () => setSaveFailed(true),
        );
    },
    [client, userId, progress],
  );

  return { progress, record, saveFailed };
}
