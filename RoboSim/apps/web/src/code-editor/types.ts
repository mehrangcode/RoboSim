import type { BuildDiagnostic } from '@robosim/shared';

export interface SketchFile {
  readonly name: string;
  readonly content: string;
}

/** Ask the editor to put the caret on a diagnostic; `seq` makes repeated clicks on one line count. */
export interface RevealRequest {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly seq: number;
}

/** What both editor implementations (Monaco and the plain fallback) take for the active file. */
export interface EditorImplProps {
  readonly files: readonly SketchFile[];
  readonly active: string;
  readonly onChange: (name: string, content: string) => void;
  readonly diagnostics: readonly BuildDiagnostic[];
  readonly reveal: RevealRequest | null;
  readonly label: string;
  /** Shown but not editable (a project shared with the caller read-only). */
  readonly readOnly?: boolean | undefined;
}
