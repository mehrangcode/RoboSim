import type { CodeFacts, CodeRef, PinUse, PinUseKind } from '@robosim/sim-core';
import type { Node, Parser, Tree } from 'web-tree-sitter';

export interface SourceFile {
  readonly name: string;
  readonly content: string;
}

/** Arduino Uno core names (pins_arduino.h, Arduino.h) that pin arguments use. */
const BUILTINS: ReadonlyMap<string, number> = new Map([
  ['LED_BUILTIN', 13],
  ['A0', 14],
  ['A1', 15],
  ['A2', 16],
  ['A3', 17],
  ['A4', 18],
  ['A5', 19],
  ['HIGH', 1],
  ['LOW', 0],
  ['INPUT', 0],
  ['OUTPUT', 1],
  ['INPUT_PULLUP', 2],
]);

const MODES = ['INPUT', 'OUTPUT', 'INPUT_PULLUP'] as const;

/** Direct port access drives pins behind the analysis' back (PINx only reads). */
const PORT_REGISTER = /^(DDR|PORT)[BCD]$/;

/** Integer types a pin constant is declared with. */
const INTEGRAL = new Set([
  'int',
  'short',
  'long',
  'unsigned',
  'signed',
  'char',
  'byte',
  'word',
  'size_t',
  'pin_size_t',
  'uint8_t',
  'int8_t',
  'uint16_t',
  'int16_t',
  'uint32_t',
  'int32_t',
]);

/** Pin calls: the pin argument's index and how the call uses the pin. */
const CALLS: ReadonlyMap<string, PinUseKind> = new Map([
  ['pinMode', 'pinMode'],
  ['digitalWrite', 'digitalWrite'],
  ['digitalRead', 'digitalRead'],
  ['analogWrite', 'analogWrite'],
  ['analogRead', 'analogRead'],
  ['tone', 'tone'],
  ['noTone', 'tone'],
]);

/** Uno pin number → board pin id (14–19 are A0–A5). */
function pinId(n: number): string | null {
  if (!Number.isInteger(n) || n < 0 || n > 19) return null;
  return n < 14 ? `D${n}` : `A${n - 14}`;
}

/** `analogRead` takes a channel (0–5) or the pin number (A0 = 14). */
const analogPinId = (n: number): string | null => (n >= 0 && n <= 5 ? `A${n}` : n >= 14 ? pinId(n) : null);

function walk(node: Node, visit: (n: Node) => void): void {
  visit(node);
  for (const c of node.namedChildren) if (c) walk(c, visit);
}

/** A named constant's value; null when it is not constant, undefined when there is no such name. */
type Lookup = (name: string) => number | null | undefined;

/** Integer value of a constant expression, or null when it is not one. */
function evaluate(node: Node | null, env: Lookup): number | null {
  if (!node) return null;
  switch (node.type) {
    case 'number_literal': {
      const text = node.text.replace(/['_]/g, '').replace(/[uUlL]+$/, '');
      const n = /^0[bB][01]+$/.test(text)
        ? parseInt(text.slice(2), 2)
        : /^0[xX][0-9a-fA-F]+$/.test(text)
          ? parseInt(text.slice(2), 16)
          : /^0[0-7]+$/.test(text)
            ? parseInt(text.slice(1), 8)
            : /^\d+$/.test(text)
              ? parseInt(text, 10)
              : NaN;
      return Number.isFinite(n) ? n : null;
    }
    case 'identifier': {
      const v = env(node.text);
      return v !== undefined ? v : (BUILTINS.get(node.text) ?? null);
    }
    case 'parenthesized_expression':
      return evaluate(node.namedChildren[0] ?? null, env);
    case 'unary_expression': {
      const v = evaluate(node.childForFieldName('argument'), env);
      const op = node.childForFieldName('operator')?.text;
      return v === null ? null : op === '-' ? -v : op === '+' ? v : null;
    }
    case 'binary_expression': {
      const a = evaluate(node.childForFieldName('left'), env);
      const b = evaluate(node.childForFieldName('right'), env);
      if (a === null || b === null) return null;
      const op = node.childForFieldName('operator')?.text;
      return op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : null;
    }
    default:
      return null;
  }
}

const isConstDeclaration = (decl: Node): boolean =>
  decl.namedChildren.some((c) => c?.type === 'type_qualifier' && /^(const|constexpr)$/.test(c.text)) &&
  (decl
    .childForFieldName('type')
    ?.text.split(/\s+/)
    .every((w) => INTEGRAL.has(w)) ??
    false);

/**
 * Pin usage of an Arduino sketch (FR-COD-06): every pin call with a constant pin is a `PinUse`; a pin
 * call whose pin (or mode) is not a constant expression is listed as unresolved. Constants: literals,
 * A0–A5, LED_BUILTIN, `#define`, and `const` / `constexpr` integer declarations, with + − ×.
 */
export function extractPinUsage(parser: Parser, files: readonly SourceFile[]): CodeFacts {
  const parsed: Tree[] = [];
  const parse = (text: string): Node | null => {
    const tree = parser.parse(text);
    if (tree) parsed.push(tree);
    return tree?.rootNode ?? null;
  };
  try {
    return extract(
      files.map((f) => ({ file: f.name, root: parse(f.content) })),
      parse,
    );
  } finally {
    for (const t of parsed) t.delete(); // trees live in WASM memory
  }
}

function extract(
  trees: readonly { file: string; root: Node | null }[],
  parse: (text: string) => Node | null,
): CodeFacts {
  // Pass 1: constants, across every file (Arduino merges the .ino tabs; headers share defines).
  // A name defined twice with different values is not a constant.
  const raw = new Map<string, Node[]>();
  const add = (name: string, value: Node | null) => {
    if (value) raw.set(name, [...(raw.get(name) ?? []), value]);
  };
  for (const { root } of trees) {
    if (!root) continue;
    walk(root, (n) => {
      if (n.type === 'preproc_def') {
        const value = n.childForFieldName('value');
        const name = n.childForFieldName('name')?.text;
        // The replacement text is parsed as an initialiser so the evaluator sees an expression.
        const init = value
          ? parse(`int __robosim = ${value.text};`)?.descendantsOfType('init_declarator')[0]
          : null;
        if (name && init) add(name, init.childForFieldName('value'));
      } else if (n.type === 'declaration' && isConstDeclaration(n)) {
        for (const d of n.childrenForFieldName('declarator')) {
          if (d.type !== 'init_declarator') continue;
          const name = d.childForFieldName('declarator');
          if (name?.type === 'identifier') add(name.text, d.childForFieldName('value'));
        }
      }
    });
  }
  const env = new Map<string, number | null>();
  const resolving = new Set<string>();
  const lookup: Lookup = (name) => {
    const values = raw.get(name);
    if (!values) return undefined;
    if (env.has(name)) return env.get(name) ?? null;
    if (resolving.has(name)) return null; // #define A B / #define B A
    resolving.add(name);
    const vs = values.map((v) => evaluate(v, lookup));
    resolving.delete(name);
    const v = vs.every((x) => x !== null && x === vs[0]) ? (vs[0] ?? null) : null;
    env.set(name, v);
    return v;
  };

  // Pass 2: Servo objects, then pin calls.
  const servos = new Set<string>();
  for (const { root } of trees) {
    if (!root) continue;
    walk(root, (n) => {
      if (
        (n.type === 'declaration' || n.type === 'field_declaration') &&
        n.childForFieldName('type')?.text === 'Servo'
      )
        for (const d of n.childrenForFieldName('declarator'))
          if (d.type === 'identifier' || d.type === 'field_identifier') servos.add(d.text);
    });
  }

  const uses: PinUse[] = [];
  const unresolved: { call: string; at: CodeRef }[] = [];
  const includes = new Set<string>();
  const local = new Set(trees.map((t) => t.file));
  for (const { file, root } of trees) {
    if (!root) continue;
    walk(root, (n) => {
      const at: CodeRef = { file, line: n.startPosition.row + 1, column: n.startPosition.column + 1 };
      if (n.type === 'preproc_include') {
        const path = n.childForFieldName('path')?.text.replace(/^[<"]|[>"]$/g, '');
        if (path && !local.has(path)) includes.add(path);
        return;
      }
      if (n.type === 'identifier' && PORT_REGISTER.test(n.text)) {
        unresolved.push({ call: n.text, at });
        return;
      }
      if (n.type !== 'call_expression') return;
      const fn = n.childForFieldName('function');
      const args = n.childForFieldName('arguments')?.namedChildren ?? [];
      let use: PinUseKind | undefined;
      if (fn?.type === 'identifier') use = CALLS.get(fn.text);
      else if (
        fn?.type === 'field_expression' &&
        fn.childForFieldName('field')?.text === 'attach' &&
        servos.has(fn.childForFieldName('argument')?.text ?? '')
      )
        use = 'servo';
      if (!use || !fn) return;
      const call = use === 'servo' ? 'Servo.attach' : fn.text;
      const n0 = evaluate(args[0] ?? null, lookup);
      const pin = n0 === null ? null : use === 'analogRead' ? analogPinId(n0) : pinId(n0);
      if (pin === null) {
        unresolved.push({ call, at });
        return;
      }
      if (use === 'pinMode') {
        const m = evaluate(args[1] ?? null, lookup);
        const mode = m === null ? undefined : MODES[m];
        if (!mode) {
          unresolved.push({ call, at });
          return;
        }
        uses.push({ pin, use, mode, at });
      } else uses.push({ pin, use, at });
    });
  }
  return { uses, unresolved, includes: [...includes] };
}
