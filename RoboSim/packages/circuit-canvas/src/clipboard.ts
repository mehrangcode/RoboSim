import { findManifest } from '@robosim/catalog/manifests';
import { CIRCUIT_CLIP_FORMAT, PROJECT_SCHEMA_VERSION, circuitClipSchema } from '@robosim/shared';
import { copySelection, deleteComponents, pasteClip, pasteOffset, type CircuitClip } from './document.js';
import type { CircuitEditorState } from './use-circuit-editor.js';

/**
 * Circuit copy/paste between projects, tabs and windows (FR-CIR-09). A clip travels as JSON text on
 * the system clipboard and is mirrored in localStorage, which serves when clipboard access is denied.
 */
const STORAGE_KEY = 'robosim.circuit.clipboard';

export const serializeClip = (clip: CircuitClip): string =>
  JSON.stringify({ format: CIRCUIT_CLIP_FORMAT, schemaVersion: PROJECT_SCHEMA_VERSION, ...clip });

/** A clip from clipboard text, or null when the text is not one (or names parts this app lacks). */
export function parseClip(text: string | null | undefined): CircuitClip | null {
  if (!text?.includes(CIRCUIT_CLIP_FORMAT)) return null;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = circuitClipSchema.safeParse(json);
  if (!parsed.success) return null;
  const { components, wires } = parsed.data;
  if (components.some((c) => !findManifest(c.type))) return null;
  const ids = new Set(components.map((c) => c.id));
  return { components, wires: wires.filter((w) => ids.has(w.from.part) && ids.has(w.to.part)) };
}

function remember(text: string) {
  try {
    localStorage.setItem(STORAGE_KEY, text);
  } catch {
    // Storage blocked: the system clipboard still has it.
  }
}

function recall(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export async function writeClip(clip: CircuitClip): Promise<void> {
  const text = serializeClip(clip);
  remember(text);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // No permission or no Clipboard API: the in-app copy above is used on paste.
  }
}

/** The clip on the system clipboard; the in-app copy only when the clipboard cannot be read. */
export async function readClip(): Promise<CircuitClip | null> {
  let text: string;
  try {
    text = await navigator.clipboard.readText();
  } catch {
    return parseClip(recall());
  }
  return parseClip(text);
}

/** Copies the selected parts; true when there was something to copy. */
export async function copyParts(editor: CircuitEditorState): Promise<boolean> {
  const clip = copySelection(editor.doc, editor.selection.parts);
  if (!clip) return false;
  await writeClip(clip);
  return true;
}

export async function cutParts(editor: CircuitEditorState): Promise<boolean> {
  const ids = editor.selection.parts;
  if (!(await copyParts(editor))) return false;
  editor.apply((d) => deleteComponents(d, ids));
  editor.setSelection({ parts: [], wire: null });
  return true;
}

/** Pastes the clipboard's parts around the view centre and selects them; false when it holds none. */
export async function pasteParts(editor: CircuitEditorState): Promise<boolean> {
  const clip = await readClip();
  if (!clip) return false;
  const { doc } = editor;
  const pasted = pasteClip(doc, clip, pasteOffset(doc, clip, editor.viewCenterRef.current));
  editor.apply(() => pasted.doc);
  editor.setSelection({ parts: pasted.ids, wire: null });
  return true;
}
