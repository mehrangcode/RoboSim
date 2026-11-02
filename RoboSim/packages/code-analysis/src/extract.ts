import type { CodeFacts, CodeRef, LibraryPin, PinArg, PinUse, PinUseKind } from '@robosim/sim-core';
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

/**
 * Library objects whose constructor names pins (FR-SAF-08): the role of each constructor argument, by
 * position (`null` = not a pin).
 */
const LIBRARY_CTORS: ReadonlyMap<string, readonly (LibraryPin['role'] | null)[]> = new Map([
  ['NewPing', ['out', 'in']],
  ['SoftwareSerial', ['in', 'out']],
  ['Stepper', [null, 'out', 'out', 'out', 'out']],
  ['Adafruit_NeoPixel', [null, 'out']],
  ['OneWire', ['bidir']],
]);

/** A pin number written as a literal or an Uno core name (what a quick fix may rewrite). */
const PIN_TOKEN = /^(\d+|A[0-5]|LED_BUILTIN)$/;

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
    case 'identifier':
    case 'type_identifier': {
      // a name in `DHT d(PIN, DHT11)`, parsed as a parameter type
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

/**
 * Constructor arguments of `Type name(ARGS)` declarations, one list per declarator (`DHT d(PIN, DHT11)`,
 * `NewPing sonar(TRIG, ECHO, 200)`). `Type d(PIN, X)` with named constants parses as a function
 * declaration whose "parameter types" are the arguments, so those count too.
 */
function ctorArgs(decl: Node, type: string): Node[][] {
  const all = (list: Node | null | undefined): Node[] =>
    (list?.namedChildren ?? []).filter((c): c is Node => c !== null && c.type !== 'comment');
  if (decl.type === 'field_declaration') {
    const init = decl.childForFieldName('default_value');
    return init ? [all(init)] : [];
  }
  return decl.childrenForFieldName('declarator').flatMap((d): Node[][] => {
    if (d.type === 'init_declarator') {
      const value = d.childForFieldName('value');
      if (value?.type === 'argument_list' || value?.type === 'initializer_list') return [all(value)];
      if (value?.type === 'call_expression' && value.childForFieldName('function')?.text === type)
        return [all(value.childForFieldName('arguments'))];
      return [];
    }
    if (d.type === 'function_declarator') {
      const params = d.childForFieldName('parameters')?.namedChildren ?? [];
      // A real function declaration names its parameters; an object declaration has bare names.
      const bare = (p: Node | null) =>
        p?.type === 'parameter_declaration' &&
        !p.childForFieldName('declarator') &&
        p.childForFieldName('type')?.type === 'type_identifier';
      if (!params.length || !params.every(bare)) return [];
      return [params.map((p) => p?.childForFieldName('type')).filter((t): t is Node => !!t)];
    }
    return [];
  });
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
 * call whose pin (or mode) is not a constant expression is listed as unresolved. `Servo.attach(pin)` and
 * `DHT name(pin, type)` declarations count as pin uses too. Constants: literals,
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
  /** Where each definition writes its value, when that value is a plain pin token (quick fixes). */
  const spans = new Map<string, (PinArg | null)[]>();
  const add = (name: string, value: Node | null, span: PinArg | null) => {
    if (!value) return;
    raw.set(name, [...(raw.get(name) ?? []), value]);
    spans.set(name, [...(spans.get(name) ?? []), span]);
  };
  for (const { file, root } of trees) {
    if (!root) continue;
    walk(root, (n) => {
      if (n.type === 'preproc_def') {
        const value = n.childForFieldName('value');
        const name = n.childForFieldName('name')?.text;
        // The replacement text is parsed as an initialiser so the evaluator sees an expression.
        const init = value
          ? parse(`int __robosim = ${value.text};`)?.descendantsOfType('init_declarator')[0]
          : null;
        if (name && init) add(name, init.childForFieldName('value'), value ? defineSpan(file, value) : null);
      } else if (n.type === 'declaration' && isConstDeclaration(n)) {
        for (const d of n.childrenForFieldName('declarator')) {
          if (d.type !== 'init_declarator') continue;
          const name = d.childForFieldName('declarator');
          const value = d.childForFieldName('value');
          if (name?.type === 'identifier') add(name.text, value, value ? tokenSpan(file, value) : null);
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
  /** Span of a pin argument: its own token, or the value of the one definition it names. */
  const argSpan = (file: string, node: Node | null): PinArg | undefined => {
    if (!node) return undefined;
    const own = tokenSpan(file, node);
    if (own && (node.type === 'number_literal' || !raw.has(node.text))) return own;
    const defs = node.type === 'identifier' ? spans.get(node.text) : undefined;
    return defs?.length === 1 ? (defs[0] ?? undefined) : undefined;
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
  const libraryPins: LibraryPin[] = [];
  const local = new Set(trees.map((t) => t.file));
  const resolve = (arg: Node | null): string | null => {
    const v = arg ? evaluate(arg, lookup) : null;
    return v === null ? null : pinId(v);
  };
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
      if (n.type === 'declaration' || n.type === 'field_declaration') {
        const type = n.childForFieldName('type')?.text ?? '';
        if (type === 'DHT') {
          for (const args of ctorArgs(n, type)) {
            const arg = args[0] ?? null;
            const pin = resolve(arg);
            const span = pin ? argSpan(file, arg) : undefined;
            if (pin) uses.push({ pin, use: 'dht', at, ...(span ? { arg: span } : {}) });
            else unresolved.push({ call: 'DHT', at });
          }
          return;
        }
        const roles = LIBRARY_CTORS.get(type);
        if (roles)
          for (const args of ctorArgs(n, type))
            roles.forEach((role, i) => {
              if (role) libraryPins.push({ lib: type, pin: resolve(args[i] ?? null), role, at });
            });
        return;
      }
      if (n.type !== 'call_expression') return;
      const fn = n.childForFieldName('function');
      const args = n.childForFieldName('arguments')?.namedChildren ?? [];
      if (fn?.type === 'field_expression' && fn.text === 'Serial.begin') {
        libraryPins.push(
          { lib: 'Serial', pin: 'D0', role: 'in', at },
          { lib: 'Serial', pin: 'D1', role: 'out', at },
        );
        return;
      }
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
      const a0 = args[0] ?? null;
      const n0 = evaluate(a0, lookup);
      const pin = n0 === null ? null : use === 'analogRead' ? analogPinId(n0) : pinId(n0);
      if (pin === null) {
        unresolved.push({ call, at });
        return;
      }
      const span = argSpan(file, a0);
      const extra = {
        ...(span ? { arg: span } : {}),
        ...(use === 'analogRead' && seedsRandom(n) ? { context: 'randomSeed' as const } : {}),
      };
      if (use === 'pinMode') {
        const m = evaluate(args[1] ?? null, lookup);
        const mode = m === null ? undefined : MODES[m];
        if (!mode) {
          unresolved.push({ call, at });
          return;
        }
        uses.push({ pin, use, mode, at, ...extra });
      } else uses.push({ pin, use, at, ...extra });
    });
  }
  return { uses, unresolved, includes: [...includes], ...(libraryPins.length ? { libraryPins } : {}) };
}

/** `randomSeed(analogRead(A0))`: the call is (inside) the argument of randomSeed. */
function seedsRandom(call: Node): boolean {
  for (let p = call.parent; p; p = p.parent) {
    if (p.type === 'call_expression') return p.childForFieldName('function')?.text === 'randomSeed';
    if (p.type !== 'argument_list' && p.type !== 'parenthesized_expression' && p.type !== 'cast_expression')
      return false;
  }
  return false;
}

/** A node that is a plain pin token, as a span (positions are UTF-16 columns, like the editor's). */
function tokenSpan(file: string, node: Node): PinArg | null {
  if (!PIN_TOKEN.test(node.text) || node.startPosition.row !== node.endPosition.row) return null;
  const { row, column } = node.startPosition;
  return {
    file,
    line: row + 1,
    column: column + 1,
    endColumn: column + 1 + node.text.length,
    text: node.text,
  };
}

/** The pin token at the start of a `#define` value (`7  // pin` → `7`). */
function defineSpan(file: string, value: Node): PinArg | null {
  const m = /^(\s*)(\d+|A[0-5]|LED_BUILTIN)(?=\s*(?:$|\/\/|\/\*))/.exec(value.text);
  if (!m?.[2]) return null;
  const { row, column } = value.startPosition;
  const start = column + 1 + (m[1]?.length ?? 0);
  return { file, line: row + 1, column: start, endColumn: start + m[2].length, text: m[2] };
}
