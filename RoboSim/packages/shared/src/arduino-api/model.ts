/**
 * Shape of the editor's Arduino API table (Technical Design §4) and the helpers the per-library
 * tables are written with. Docs live in the `apidocs` i18n namespace under `docKey(entry)`:
 * `{ summary, params: { <name>: text }, returns? }` in both UI languages (FR-COD-02).
 */
export interface ArduinoApiEntry {
  readonly name: string;
  readonly kind: 'function' | 'constant' | 'type' | 'method';
  /** Signature; overloads one per line. */
  readonly detail: string;
  /** Snippet (`${1:name}` placeholders) inserted on completion. */
  readonly insert?: string;
  /** For methods: the class they belong to (see `ArduinoClass`). For a global instance: its class. */
  readonly of?: string;
  /** Parameter names over all overloads, each documented under `params.<name>`. */
  readonly params?: readonly string[];
  /** Whether a return value is documented. */
  readonly returns?: boolean;
  /** Language-neutral usage example. */
  readonly example?: string;
  /** Doc key when several entries share one doc (constant groups); defaults to `<of|core>.<name>`. */
  readonly doc?: string;
  /** A constant scoped to class `of` (a nested enum): written `Cls::NAME`, never offered as a global. */
  readonly member?: boolean;
}

export interface ArduinoClass {
  readonly name: string;
  /** Declaring library (`ArduinoLibrary.name`); null for the Arduino core. */
  readonly library: string | null;
  /** Base classes whose methods instances also have. */
  readonly extends?: readonly string[];
  /** Global objects of this class the library defines (`Serial`, `Wire`, …). */
  readonly instances?: readonly string[];
}

/** One library's (or the core's) slice of the table. */
export interface ApiTable {
  readonly classes: readonly ArduinoClass[];
  readonly entries: readonly ArduinoApiEntry[];
}

export interface ApiOptions {
  readonly example?: string;
  /** Further signatures, e.g. `'void begin(uint8_t address)'`. */
  readonly overloads?: readonly string[];
  readonly insert?: string;
  readonly doc?: string;
}

/** `uint8_t *buffer` → `buffer`; `void (*isr)()` → `isr`; `const char name[]` → `name`. */
export function paramName(param: string): string {
  const fnPtr = /\(\s*\*\s*(\w+)\s*\)/.exec(param);
  if (fnPtr?.[1]) return fnPtr[1];
  const clean = param.replace(/=.*$/, '').replace(/\[[^\]]*\]/g, '');
  return /(\w+)\W*$/.exec(clean)?.[1] ?? param;
}

/** Parameter list of a C signature, split on top-level commas. */
function signatureParams(signature: string): string[] {
  const open = signature.indexOf('(');
  const inner = signature.slice(open + 1, signature.lastIndexOf(')'));
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '(' || c === '<') depth++;
    else if (c === ')' || c === '>') depth--;
    else if (c === ',' && depth === 0) {
      out.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  out.push(inner.slice(start));
  return out.map((p) => p.trim()).filter((p) => p !== '' && p !== 'void');
}

const union = (lists: readonly (readonly string[])[]) => [...new Set(lists.flat())];

function callable(
  kind: 'function' | 'method',
  name: string,
  params: readonly string[],
  ret: string,
  opts: ApiOptions,
  of?: string,
): ArduinoApiEntry {
  const own = `${ret} ${of ? `${of}::` : ''}${name}(${params.join(', ')})`;
  const extra = (opts.overloads ?? []).map((s) => (of ? s.replace(/^(.*?)\b(\w+)\s*\(/, `$1${of}::$2(`) : s));
  const names = union([params.map(paramName), ...extra.map((s) => signatureParams(s).map(paramName))]);
  const returns = ret !== 'void' || extra.some((s) => !/^\s*void\b/.test(s));
  return {
    name,
    kind,
    detail: [own, ...extra].join('\n'),
    insert:
      opts.insert ??
      `${name}(${params
        .filter((p) => !p.includes('='))
        .map((p, i) => `\${${i + 1}:${paramName(p)}}`)
        .join(', ')})`,
    ...(of ? { of } : {}),
    ...(names.length > 0 ? { params: names } : {}),
    ...(returns ? { returns } : {}),
    ...(opts.example ? { example: opts.example } : {}),
    ...(opts.doc ? { doc: opts.doc } : {}),
  };
}

/** A core function: `fn('analogRead', ['uint8_t pin'], 'int')`. */
export const fn = (name: string, params: readonly string[], ret = 'void', opts: ApiOptions = {}) =>
  callable('function', name, params, ret, opts);

/** A class method: `method('Servo', 'attach', ['int pin'], 'uint8_t')`. */
export const method = (
  of: string,
  name: string,
  params: readonly string[],
  ret = 'void',
  opts: ApiOptions = {},
) => callable('method', name, params, ret, opts, of);

/**
 * Constants sharing one doc, e.g. `constants(['HIGH', 'LOW'], 'pin level', 'core.pinLevel')`; with
 * `of`, members of that class (`Adafruit_BMP280::MODE_NORMAL`).
 */
export const constants = (
  names: readonly string[],
  detail: string,
  doc?: string,
  of?: string,
): ArduinoApiEntry[] =>
  names.map((name) => ({
    name,
    kind: 'constant',
    detail,
    ...(doc ? { doc } : {}),
    ...(of ? { of, member: true } : {}),
  }));

/** A type or class name; classes are documented under `<name>.<name>` (the constructor). */
export const type = (
  name: string,
  detail = name,
  opts: Pick<ApiOptions, 'example' | 'doc'> = {},
): ArduinoApiEntry => ({
  name,
  kind: 'type',
  detail,
  ...(opts.example ? { example: opts.example } : {}),
  ...(opts.doc ? { doc: opts.doc } : {}),
});

/** A class with a documented constructor: `cls('Servo', ['Servo()'])`. */
export const cls = (
  name: string,
  constructors: readonly string[],
  opts: Pick<ApiOptions, 'example'> = {},
) => {
  const names = union(constructors.map((s) => signatureParams(s).map(paramName)));
  const entry: ArduinoApiEntry = {
    name,
    kind: 'type',
    detail: constructors.join('\n'),
    doc: `${name}.${name}`,
    ...(names.length > 0 ? { params: names } : {}),
    ...(opts.example ? { example: opts.example } : {}),
  };
  return entry;
};

/** A global object, e.g. `instance('Serial', 'HardwareSerial')`: completes as a constant, members via its class. */
export const instance = (name: string, of: string, detail: string): ArduinoApiEntry => ({
  name,
  kind: 'constant',
  detail,
  of,
  doc: `${of}.instance`,
});
