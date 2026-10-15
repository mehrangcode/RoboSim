import { parseProjectDocument, type ProjectDocument } from '@robosim/shared';

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

/** The document with its main sketch replaced by `code`. */
export function withCode(doc: ProjectDocument, code: string): ProjectDocument {
  const main = mainFile(doc);
  if (!main || main.content === code) return doc;
  return {
    ...doc,
    code: { ...doc.code, files: doc.code.files.map((f) => (f === main ? { ...f, content: code } : f)) },
  };
}

/** Saves a JSON file through a temporary link. */
export function downloadJson(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export const fileName = (doc: ProjectDocument) =>
  `${doc.meta.title.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-|-$/g, '') || 'project'}.robosim.json`;
