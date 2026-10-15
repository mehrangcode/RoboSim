// Arduino sketch preprocessing (what arduino-cli does with ctags): merge the .ino files, add `#include <Arduino.h>`,
// and declare every top-level function before its first use. `#line` directives keep diagnostics on the user's lines.

export interface SourceFile {
  readonly name: string;
  readonly content: string;
}

export interface Prototype {
  readonly file: string;
  /** 1-based line of the definition. */
  readonly line: number;
  readonly declaration: string;
}

interface Origin {
  readonly file: string;
  readonly line: number;
}

const NOT_A_NAME = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'return',
  'sizeof',
  'operator',
  'defined',
]);
const NOT_A_TYPE =
  /\b(return|else|new|delete|throw|case|goto|typedef|using|template|operator|enum|struct|class|union|namespace)\b|[=(){}[\];"']/;

/**
 * Blanks comments, string/char literals and preprocessor lines with spaces (newlines kept), so offsets and line
 * numbers in the result match the input.
 */
export function maskCode(src: string): string {
  const out = src.split('');
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  let lineStart = true;
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') {
      lineStart = true;
      i++;
      continue;
    }
    if (lineStart && (c === ' ' || c === '\t' || c === '\r')) {
      i++;
      continue;
    }
    if (lineStart && c === '#') {
      // Directive, including backslash continuations and comments inside it.
      let j = i;
      while (j < src.length && src[j] !== '\n') {
        if (src[j] === '\\' && src[j + 1] === '\n') j += 2;
        else if (src[j] === '/' && src[j + 1] === '*') {
          const end = src.indexOf('*/', j + 2);
          j = end < 0 ? src.length : end + 2;
        } else j++;
      }
      blank(i, j);
      i = j;
      continue;
    }
    lineStart = false;
    if (c === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i);
      const j = end < 0 ? src.length : end;
      blank(i, j);
      i = j;
    } else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const j = end < 0 ? src.length : end + 2;
      blank(i, j);
      i = j;
    } else if (c === 'R' && src[i + 1] === '"' && !/\w/.test(src[i - 1] ?? '')) {
      const open = src.indexOf('(', i + 2);
      const delim = open < 0 ? '' : src.slice(i + 2, open);
      const end = open < 0 ? -1 : src.indexOf(`)${delim}"`, open);
      const j = end < 0 ? src.length : end + delim.length + 2;
      blank(i, j);
      i = j;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      blank(i, Math.min(j + 1, src.length));
      i = j + 1;
    } else i++;
  }
  return out.join('');
}

/**
 * Prototype parameters: split at top-level commas and cut default values (the definition keeps them). `masked` has
 * literals blanked so commas and `=` inside strings are ignored; text is taken from `orig` (same offsets).
 */
function prototypeParams(masked: string, orig: string): string {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let cut = -1;
  const push = (end: number): void => {
    parts.push(
      orig
        .slice(start, cut >= 0 ? cut : end)
        .trim()
        .replace(/\s+/g, ' '),
    );
  };
  for (let i = 0; i < masked.length; i++) {
    const c = masked[i];
    if (c === '(' || c === '<' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === '>' || c === ']' || c === '}') depth--;
    else if (c === '=' && depth === 0 && cut < 0) cut = i;
    else if (c === ',' && depth === 0) {
      push(i);
      start = i + 1;
      cut = -1;
    }
  }
  push(masked.length);
  return parts.join(', ');
}

interface FunctionDef {
  /** Offset of the first character of the definition. */
  readonly start: number;
  readonly declaration: string;
}

/** Top-level function definitions in source order (masked + original text, same offsets). */
export function findFunctionDefinitions(src: string): FunctionDef[] {
  const masked = maskCode(src);
  const defs: FunctionDef[] = [];
  let depth = 0;
  let stmtStart = 0;
  for (let i = 0; i < masked.length; i++) {
    const c = masked[i];
    if (c === '{') {
      if (depth === 0) {
        const def = asDefinition(masked, src, stmtStart, i);
        if (def) defs.push(def);
      }
      depth++;
    } else if (c === '}') {
      depth = Math.max(0, depth - 1);
      if (depth === 0) stmtStart = i + 1;
    } else if (c === ';' && depth === 0) stmtStart = i + 1;
  }
  return defs;
}

function asDefinition(masked: string, src: string, from: number, brace: number): FunctionDef | undefined {
  const text = masked.slice(from, brace);
  const lead = text.length - text.trimStart().length;
  const stmt = text.trim();
  // `<type> <name>(<params>) [const]` — the parameter list is the last balanced (...) group.
  const close = stmt.replace(/\s*const\s*$/, '').length - 1;
  if (stmt[close] !== ')') return undefined;
  let depth = 0;
  let open = -1;
  for (let k = close; k >= 0; k--) {
    if (stmt[k] === ')') depth++;
    else if (stmt[k] === '(' && --depth === 0) {
      open = k;
      break;
    }
  }
  if (open < 0) return undefined;
  const head = stmt.slice(0, open).trimEnd();
  const name = /([A-Za-z_]\w*)$/.exec(head)?.[1];
  if (!name || NOT_A_NAME.has(name)) return undefined;
  const type = head.slice(0, head.length - name.length);
  if (type.trimEnd().endsWith('::') || type.trim() === '' || NOT_A_TYPE.test(type)) return undefined;
  const start = from + lead;
  const params = prototypeParams(
    masked.slice(from + lead + open + 1, from + lead + close),
    src.slice(from + lead + open + 1, from + lead + close),
  );
  const trailer = stmt.slice(close + 1).trim();
  const declaration = `${type.trim().replace(/\s+/g, ' ')} ${name}(${params})${trailer ? ` ${trailer}` : ''};`;
  return { start, declaration };
}

export interface PreprocessedSketch {
  /** The C++ translation unit for the merged .ino files. */
  readonly code: string;
  readonly prototypes: readonly Prototype[];
}

/**
 * Merges the .ino files (the main one first, the rest alphabetically, as the Arduino IDE does) into one translation
 * unit with `#include <Arduino.h>` and generated prototypes inserted before the first function definition.
 */
export function preprocessSketch(inoFiles: readonly SourceFile[], mainName: string): PreprocessedSketch {
  const main = inoFiles.find((f) => f.name === mainName);
  if (!main) throw new Error(`main sketch ${mainName} not among the .ino files`);
  const ordered = [main, ...inoFiles.filter((f) => f !== main).sort((a, b) => (a.name < b.name ? -1 : 1))];

  // Merged text plus, for every merged line, where it came from.
  const lines: string[] = [];
  const origins: Origin[] = [];
  for (const f of ordered) {
    const fileLines = f.content.split('\n');
    if (fileLines.at(-1) === '') fileLines.pop();
    fileLines.forEach((l, k) => {
      lines.push(l);
      origins.push({ file: f.name, line: k + 1 });
    });
  }
  const merged = lines.join('\n');
  const lineOf = (offset: number): number => {
    let n = 0;
    for (let k = 0; k < offset; k++) if (merged.charCodeAt(k) === 10) n++;
    return n;
  };

  const defs = findFunctionDefinitions(merged);
  const originAt = (k: number): Origin => {
    const o = origins[k];
    if (!o) throw new Error(`no origin for merged line ${k}`);
    return o;
  };
  const prototypes = defs.map((d) => {
    const o = originAt(lineOf(d.start));
    return { file: o.file, line: o.line, declaration: d.declaration };
  });
  const insertAt = defs[0] ? lineOf(defs[0].start) : lines.length;

  const out: string[] = ['#include <Arduino.h>'];
  let previous: Origin | undefined;
  const emit = (k: number): void => {
    const o = originAt(k);
    if (!previous || previous.file !== o.file || previous.line + 1 !== o.line)
      out.push(`#line ${o.line} "${o.file}"`);
    out.push(lines[k] ?? '');
    previous = o;
  };
  for (let k = 0; k < insertAt; k++) emit(k);
  for (const p of prototypes) out.push(`#line ${p.line} "${p.file}"`, p.declaration);
  previous = undefined;
  for (let k = insertAt; k < lines.length; k++) emit(k);
  return { code: `${out.join('\n')}\n`, prototypes };
}
