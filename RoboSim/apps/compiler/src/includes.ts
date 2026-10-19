// Include scanning and source guards. The sandbox is the security boundary; these checks are defence in depth and
// give clear diagnostics instead of opaque compiler failures (Security §5: includes only from the sketch + allow-list).
import type { BuildDiagnostic } from '@robosim/shared';
import type { SourceFile } from './preprocess.js';

export interface Include {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly name: string;
  readonly quoted: boolean;
}

const INCLUDE = /^(\s*#\s*)(include|include_next|import)\b\s*(.*)$/;
const TARGET = /^(<([^>]*)>|"([^"]*)")/;
const SAFE_PATH = /^(?!\/)(?!.*(^|\/)\.\.(\/|$))[A-Za-z0-9_\-./+]+$/;
/** Assembler directives that read host files into the output. */
const FILE_READING_ASM = /\.\s*(incbin|include)\b/i;

/** Every `#include` in the files, plus diagnostics for includes and constructs the build refuses. */
export function scanSources(files: readonly SourceFile[]): {
  includes: Include[];
  errors: BuildDiagnostic[];
} {
  const includes: Include[] = [];
  const errors: BuildDiagnostic[] = [];
  const refuse = (file: string, line: number, column: number, message: string): void => {
    errors.push({ file, line, column, severity: 'error', message, explanationKey: 'unsafe_source' });
  };
  for (const f of files) {
    f.content.split(/\r?\n/).forEach((text, k) => {
      const line = k + 1;
      const asm = FILE_READING_ASM.exec(text);
      if (asm) refuse(f.name, line, asm.index + 1, `assembler directive '${asm[0]}' is not allowed`);
      const m = INCLUDE.exec(text);
      if (!m) return;
      const [, lead = '', directive, rest = ''] = m;
      const column = lead.length;
      if (directive !== 'include') {
        refuse(f.name, line, column, `#${directive} is not allowed; use #include`);
        return;
      }
      const target = TARGET.exec(rest);
      if (!target) {
        refuse(f.name, line, column, '#include needs a literal <file> or "file" name');
        return;
      }
      const name = target[2] ?? target[3] ?? '';
      if (!SAFE_PATH.test(name)) {
        refuse(f.name, line, column, `#include "${name}": absolute paths and '..' are not allowed`);
        return;
      }
      includes.push({ file: f.name, line, column, name, quoted: target[3] !== undefined });
    });
  }
  return { includes, errors };
}

/** Includes in a library or other trusted source tree (no guards): bare names only. */
export function includedNames(content: string): string[] {
  const names: string[] = [];
  for (const text of content.split(/\r?\n/)) {
    const m = INCLUDE.exec(text);
    const target = m && TARGET.exec(m[3] ?? '');
    if (target) names.push(target[2] ?? target[3] ?? '');
  }
  return names;
}
