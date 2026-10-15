import type { BuildDiagnostic, DiagnosticSeverity } from '@robosim/shared';
import { explain } from './explanations.js';

export interface PathMap {
  /** Absolute prefix → display prefix (e.g. the toolchain dir → `arduino:avr/`). Longest prefix first. */
  readonly prefixes: ReadonlyArray<readonly [from: string, to: string]>;
}

const LOCATED = /^(.+?):(\d+):(?:(\d+):)? (fatal error|error|warning|note): (.*)$/;
const LINKER = /^(?:.*?: )?((?:undefined reference to|multiple definition of) .*)$/;
const LINKER_REGION = /(region `\w+' overflowed by \d+ bytes|will not fit in region `\w+')/;

function displayPath(path: string, map: PathMap): string {
  for (const [from, to] of map.prefixes) if (path.startsWith(from)) return to + path.slice(from.length);
  return path.replace(/^\.\//, '');
}

/**
 * Parses gcc/ld output into diagnostics. User files keep their names (sketch-relative compile + `#line`); toolchain
 * paths are shortened so host paths never reach the client. Context lines ("In function", "In file included from")
 * are dropped; duplicates (gcc repeats some for each LTO partition) are removed.
 */
export function parseDiagnostics(output: string, map: PathMap): BuildDiagnostic[] {
  const out: BuildDiagnostic[] = [];
  const seen = new Set<string>();
  const push = (d: BuildDiagnostic): void => {
    const key = `${d.file}:${d.line}:${d.column}:${d.severity}:${d.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    const explanationKey = d.severity === 'note' ? undefined : explain(d.message);
    out.push(explanationKey ? { ...d, explanationKey } : d);
  };
  for (const raw of output.split('\n')) {
    const line = raw.trimEnd();
    const m = LOCATED.exec(line);
    if (m) {
      const [, path = '', lineNo, col, kind, message = ''] = m;
      const severity: DiagnosticSeverity = kind === 'fatal error' ? 'error' : (kind as DiagnosticSeverity);
      // ld reports some errors as `file:line: ...` without a column; LTO temp objects have no user location.
      const file = /\.ltrans\d*\.o$|\.o$|^\/tmp\//.test(path) ? '' : displayPath(path, map);
      push({
        file,
        line: file ? Number(lineNo) : 0,
        column: col && file ? Number(col) : 0,
        severity,
        message,
      });
      continue;
    }
    const region = LINKER_REGION.exec(line);
    if (region) {
      push({ file: '', line: 0, column: 0, severity: 'error', message: region[1] ?? line });
      continue;
    }
    const link = LINKER.exec(line);
    if (link)
      push({
        file: '',
        line: 0,
        column: 0,
        severity: 'error',
        message: (link[1] ?? line).replace(/^.*?: /, ''),
      });
  }
  return out;
}
