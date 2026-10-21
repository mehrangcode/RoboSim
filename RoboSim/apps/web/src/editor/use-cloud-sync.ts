import { parseProjectDocument, type ProjectDocument, type ProjectVersionSummary } from '@robosim/shared';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api.js';
import type { ProjectsClient } from '../lib/projects-api.js';
import { loadCloudDraft, saveCloudDraft } from './project-store.js';

/** Cloud autosave cadence (FR-WRK-04). */
export const AUTOSAVE_MS = 30_000;

/** A cloud project as the editor opens it. */
export interface CloudOpen {
  readonly id: string;
  readonly revision: number;
  /** The document as the server has it. */
  readonly saved: ProjectDocument;
  /** What the editor starts with: unsaved edits from this browser when they still apply. */
  readonly start: ProjectDocument;
  /** Unsaved edits from this browser made against an older revision: the user chooses. */
  readonly staleDraft: ProjectDocument | null;
  /** The server was unreachable; the editor opened this browser's copy. */
  readonly offline: boolean;
}

export type OpenResult =
  | { readonly kind: 'ready'; readonly open: CloudOpen }
  | { readonly kind: 'missing' }
  | { readonly kind: 'failed'; readonly message: string };

/** Fetches a project and reconciles it with this browser's draft. */
export async function openCloudProject(client: ProjectsClient, id: string): Promise<OpenResult> {
  const draft = loadCloudDraft(id);
  try {
    const project = await client.get(id);
    const saved = parseProjectDocument(project.document);
    const differs = draft !== null && JSON.stringify(draft.document) !== JSON.stringify(saved);
    const current = differs && draft.baseRevision === project.revision;
    return {
      kind: 'ready',
      open: {
        id,
        revision: project.revision,
        saved,
        start: current ? draft.document : saved,
        staleDraft: differs && !current ? draft.document : null,
        offline: false,
      },
    };
  } catch (e) {
    if (e instanceof ApiError && e.problem.code === 'not_found') return { kind: 'missing' };
    if (!(e instanceof ApiError) && draft)
      return {
        kind: 'ready',
        open: {
          id,
          revision: draft.baseRevision,
          saved: draft.document,
          start: draft.document,
          staleDraft: null,
          offline: true,
        },
      };
    return { kind: 'failed', message: e instanceof ApiError ? e.problem.title : (e as Error).message };
  }
}

export type CloudStatus = 'saved' | 'unsaved' | 'saving' | 'offline' | 'error' | 'conflict';

/** Someone else saved first (412), or this browser holds edits made against an older revision. */
export interface CloudConflict {
  readonly mine: ProjectDocument;
  /** The editor already shows `mine` (a failed save) or the server copy (a stale draft on open). */
  readonly showing: 'mine' | 'server';
}

/**
 * Keeps an open cloud project in step with the server (FR-WRK-04, API Spec §4.4): every change goes to this
 * browser's draft at once and to the server every 30 s, on Ctrl+S, when the tab is hidden and when the
 * connection returns. Saves carry `If-Match`; a 412 becomes a conflict the user resolves. Without `open` (a local
 * project) it does nothing.
 */
export function useCloudSync(open: CloudOpen | undefined, client: ProjectsClient, current: ProjectDocument) {
  const [revision, setRevision] = useState(open?.revision ?? 0);
  const [savedJson, setSavedJson] = useState(() => (open ? JSON.stringify(open.saved) : ''));
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<'offline' | 'error' | null>(open?.offline ? 'offline' : null);
  const [message, setMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState<CloudConflict | null>(() =>
    open?.staleDraft ? { mine: open.staleDraft, showing: 'server' } : null,
  );
  const json = open ? JSON.stringify(current) : '';
  const dirty = open !== undefined && json !== savedJson;

  // Refs give the timers and the async save the latest values without re-subscribing.
  const latest = useRef({ current, json, revision, dirty, conflict });
  useLayoutEffect(() => {
    latest.current = { current, json, revision, dirty, conflict };
  });
  const inFlight = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    if (!open || conflict) return;
    saveCloudDraft(open.id, dirty ? { document: current, baseRevision: revision } : null);
  });

  const save = useCallback(async (): Promise<boolean> => {
    if (!open) return true;
    if (inFlight.current) await inFlight.current;
    const { current: doc, json: sent, revision: base, dirty: isDirty, conflict: blocked } = latest.current;
    if (blocked) return false;
    if (!isDirty) return true;
    const run = (async () => {
      setSaving(true);
      try {
        const result = await client.save(open.id, base, doc);
        setRevision(result.revision);
        setSavedJson(sent);
        latest.current = { ...latest.current, revision: result.revision };
        setProblem(null);
        setMessage(null);
        return true;
      } catch (e) {
        if (e instanceof ApiError && e.problem.code === 'precondition_failed') {
          setConflict({ mine: doc, showing: 'mine' });
          saveCloudDraft(open.id, { document: doc, baseRevision: base });
        } else if (e instanceof ApiError) {
          setProblem('error');
          setMessage(e.problem.title);
        } else setProblem('offline');
        return false;
      } finally {
        setSaving(false);
        inFlight.current = null;
      }
    })();
    inFlight.current = run;
    return run;
  }, [open, client]);

  useEffect(() => {
    if (!open) return;
    const flush = () => {
      if (latest.current.dirty) void save();
    };
    const timer = setInterval(flush, AUTOSAVE_MS);
    const onHide = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('online', flush);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', flush);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [open, save]);

  /**
   * Resolves a conflict. `server` takes the saved copy and drops this browser's edits; `mine` overwrites the
   * server with them. Returns the document the editor should now show, or null when it already shows it.
   */
  const resolve = useCallback(
    async (keep: 'server' | 'mine'): Promise<ProjectDocument | null> => {
      if (!open || !conflict) return null;
      try {
        const project = await client.get(open.id);
        const server = parseProjectDocument(project.document);
        if (keep === 'server') {
          setRevision(project.revision);
          setSavedJson(JSON.stringify(server));
          saveCloudDraft(open.id, null);
          setConflict(null);
          return conflict.showing === 'server' ? null : server;
        }
        const result = await client.save(open.id, project.revision, conflict.mine);
        setRevision(result.revision);
        setSavedJson(JSON.stringify(conflict.mine));
        setConflict(null);
        setProblem(null);
        return conflict.showing === 'mine' ? null : conflict.mine;
      } catch (e) {
        setProblem(e instanceof ApiError ? 'error' : 'offline');
        if (e instanceof ApiError) setMessage(e.problem.title);
        return null;
      }
    },
    [open, client, conflict],
  );

  /** Saves pending edits first, so builds, checkpoints and restores see what is on screen. */
  const flush = useCallback(async () => (latest.current.dirty ? save() : !latest.current.conflict), [save]);

  const versions = useCallback(async (): Promise<ProjectVersionSummary[]> => {
    if (!open) return [];
    return (await client.versions(open.id)).items;
  }, [open, client]);

  const checkpoint = useCallback(
    async (label: string): Promise<boolean> => {
      if (!open || !(await flush())) return false;
      await client.checkpoint(open.id, label);
      return true;
    },
    [open, client, flush],
  );

  /** Restores a version as the working document; returns it for the editor, or null when nothing changed. */
  const restoreVersion = useCallback(
    async (versionId: string): Promise<ProjectDocument | null> => {
      if (!open || !(await flush())) return null;
      const project = await client.restoreVersion(open.id, versionId, latest.current.revision);
      const doc = parseProjectDocument(project.document);
      setRevision(project.revision);
      setSavedJson(JSON.stringify(doc));
      latest.current = { ...latest.current, revision: project.revision };
      return doc;
    },
    [open, client, flush],
  );

  const status: CloudStatus = conflict
    ? 'conflict'
    : saving
      ? 'saving'
      : (problem ?? (dirty ? 'unsaved' : 'saved'));

  return {
    status,
    message,
    revision,
    dirty,
    conflict,
    save,
    flush,
    resolve,
    versions,
    checkpoint,
    restoreVersion,
  };
}

export type CloudSync = ReturnType<typeof useCloudSync>;
