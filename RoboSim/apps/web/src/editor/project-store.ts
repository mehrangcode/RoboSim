import { parseProjectDocument, type ProjectDocument } from '@robosim/shared';
import type { SourceFile } from '@robosim/sim-runtime/client';

/*
 * The workspace project lives in this browser until accounts and cloud projects arrive (P2).
 * Alongside it we keep the key of the project as it was opened, to know whether replacing it
 * would lose work.
 */

const STORAGE_KEY = 'robosim.editor.project.v1';

export interface StoredProject {
  readonly project: ProjectDocument;
  /** `runKey` of the project when it was created, opened or imported. */
  readonly pristine: string;
}

/** What makes two projects run the same: everything but the title and description. */
export const runKey = (doc: ProjectDocument): string => JSON.stringify({ ...doc, meta: null });

export function loadStored(): StoredProject | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { project?: unknown; pristine?: unknown };
    return {
      project: parseProjectDocument(parsed.project),
      pristine: typeof parsed.pristine === 'string' ? parsed.pristine : '',
    };
  } catch {
    return null; // unreadable or from an incompatible version: start fresh
  }
}

export function saveStored(stored: StoredProject): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    return true;
  } catch {
    return false; // storage full or disabled: the project still lives in memory
  }
}

/** The main sketch file (`.ino`), if any. */
export const mainFile = (doc: ProjectDocument) => doc.code.files.find((f) => f.name.endsWith('.ino'));

/** The document with its sketch files replaced by `files` (itself when nothing changed). */
export function withFiles(doc: ProjectDocument, files: readonly SourceFile[]): ProjectDocument {
  const same =
    files.length === doc.code.files.length &&
    files.every((f, i) => f.name === doc.code.files[i]?.name && f.content === doc.code.files[i]?.content);
  return same ? doc : { ...doc, code: { ...doc.code, files: files.map((f) => ({ ...f })) } };
}

/*
 * Cloud projects keep a per-project copy of unsaved edits in this browser, with the server revision they
 * started from, so a closed tab or a lost connection never loses work (FR-WRK-04 local layer).
 */
const cloudKey = (id: string) => `robosim.editor.cloud.v1.${id}`;

export interface CloudDraft {
  readonly document: ProjectDocument;
  /** Server revision the edits are based on. */
  readonly baseRevision: number;
}

export function loadCloudDraft(id: string): CloudDraft | null {
  try {
    const raw = localStorage.getItem(cloudKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { document?: unknown; baseRevision?: unknown };
    if (typeof parsed.baseRevision !== 'number') return null;
    return { document: parseProjectDocument(parsed.document), baseRevision: parsed.baseRevision };
  } catch {
    return null;
  }
}

export function saveCloudDraft(id: string, draft: CloudDraft | null): void {
  try {
    if (draft) localStorage.setItem(cloudKey(id), JSON.stringify(draft));
    else localStorage.removeItem(cloudKey(id));
  } catch {
    // storage full or disabled: the edits still live in memory until the next save
  }
}
