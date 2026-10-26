import {
  PROJECT_SCHEMA_VERSION,
  ProjectDocumentError,
  parseProjectDocument,
  type ProjectDocument,
} from '@robosim/shared';
import type { TFunction } from 'i18next';
import { strFromU8, unzipSync, zipSync } from 'fflate';

/**
 * `.robosim` project files (FR-PRJ-06): a zip with `manifest.json` (format and schema version) and
 * `project.json` (the document), with room for assets later. Import also takes the older plain-JSON
 * export (`.robosim.json`) and exported input logs, which carry their project; every document is
 * migrated and validated before use.
 */

/** UTF-8 bytes as this realm's `Uint8Array` (fflate tells files from folders with `instanceof`). */
export const utf8 = (text: string): Uint8Array => new Uint8Array(new TextEncoder().encode(text));

export const ROBOSIM_FORMAT = 'robosim';
export const ROBOSIM_FORMAT_VERSION = 1;
export const PROJECT_FILE_ACCEPT = '.robosim,.json,application/zip,application/json';

export class ProjectFileError extends Error {
  constructor(readonly reason: 'unreadable' | 'newer' | 'missing_project') {
    super(reason);
  }
}

interface Manifest {
  readonly format: string;
  readonly formatVersion: number;
  readonly schemaVersion: number;
  readonly exportedAt: string;
}

export function encodeProjectFile(doc: ProjectDocument, now: Date = new Date()): Uint8Array<ArrayBuffer> {
  const manifest: Manifest = {
    format: ROBOSIM_FORMAT,
    formatVersion: ROBOSIM_FORMAT_VERSION,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    exportedAt: now.toISOString(),
  };
  // A fresh copy: Blob takes only ArrayBuffer-backed arrays.
  return new Uint8Array(
    zipSync({
      'manifest.json': utf8(JSON.stringify(manifest, null, 2)),
      'project.json': utf8(JSON.stringify(doc, null, 2)),
    }),
  );
}

const isZip = (bytes: Uint8Array) => bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK"

/** Reads a `.robosim` zip or a JSON export; throws `ProjectFileError` or `ProjectDocumentError`. */
export async function readProjectFile(file: Blob): Promise<ProjectDocument> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isZip(bytes)) {
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(bytes);
    } catch {
      throw new ProjectFileError('unreadable');
    }
    const manifest = entries['manifest.json'];
    const project = entries['project.json'];
    if (!project) throw new ProjectFileError('missing_project');
    if (manifest) {
      const m = parseJson(strFromU8(manifest)) as Partial<Manifest>;
      if (m.format !== ROBOSIM_FORMAT) throw new ProjectFileError('unreadable');
      if ((m.formatVersion ?? 0) > ROBOSIM_FORMAT_VERSION) throw new ProjectFileError('newer');
    }
    return parseProjectDocument(parseJson(strFromU8(project)));
  }
  const json = parseJson(new TextDecoder().decode(bytes));
  // An exported input log carries its project too.
  const doc = json !== null && typeof json === 'object' && 'project' in json ? json.project : json;
  return parseProjectDocument(doc);
}

/** Why an import failed, in words: file problems by reason, document problems by their first issues. */
export function importErrorText(err: unknown, t: TFunction): string {
  if (err instanceof ProjectFileError) return t(`shell:editor.fileError.${err.reason}`);
  if (err instanceof ProjectDocumentError) return err.issues.slice(0, 3).join('; ');
  return err instanceof Error ? err.message : String(err);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ProjectFileError('unreadable');
  }
}

/** A file name from the title: letters and digits of any script, the rest folded to dashes. */
export const fileBase = (doc: ProjectDocument) =>
  doc.meta.title.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-|-$/g, '') || 'project';

/** Saves a file through a temporary link. */
export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadProject(doc: ProjectDocument) {
  downloadBlob(`${fileBase(doc)}.robosim`, new Blob([encodeProjectFile(doc)], { type: 'application/zip' }));
}
