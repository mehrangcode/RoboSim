import type {
  CodeFacts,
  CodeRef,
  LibraryPin,
  PinArg,
  PinCapability,
  PinUse,
  SignalDirection,
} from '@robosim/sim-core';

/**
 * Wiring ↔ sketch consistency (FR-SAF-08, TD §18.1): the sketch's pin facts (FR-COD-06) checked against
 * the drawn circuit while the learner edits, before any run. Topology only (no electrical probe), so it
 * runs on the main thread. Kept out of `STATIC_RULES`: verified runs, the grader and golden traces never
 * see these findings. A pin the analysis could not resolve is never guessed: no finding rather than a
 * false one.
 */

/** A part pin on a board pin's net (behind series resistors, `signalPassthrough`). */
export interface PinPeer {
  readonly partId: string;
  readonly type: string;
  readonly pin: string;
  readonly direction: SignalDirection;
}

/** What the drawn circuit connects to one MCU pin (D0–D13, A0–A5). */
export interface BoardPinView {
  readonly pin: string;
  readonly capabilities: readonly PinCapability[];
  /** Every wire on the signal's path: the pin's net and the nets behind series resistors (highlighting). */
  readonly wireIds: readonly string[];
  /** Wires with an end on this board pin itself (what a "move the wire" fix moves). */
  readonly boardWireIds: readonly string[];
  /** Anything but breadboard holes on the net: a part pin or another board pin. */
  readonly connected: boolean;
  /** Part pins the signal reaches, series resistors followed, the resistors themselves left out. */
  readonly peers: readonly PinPeer[];
}

/** One edit of a quick fix: replace the pin token at a span (`PinArg`) with `replace`. */
export interface PinEdit extends PinArg {
  readonly replace: string;
}

export type QuickFix =
  | {
      readonly kind: 'code.replacePin';
      /** Board pin the code uses now, and the one it should use. */
      readonly from: string;
      readonly to: string;
      readonly edits: readonly PinEdit[];
    }
  | {
      readonly kind: 'wire.moveEnd';
      /** Board pin the wires leave, and the one they move to. */
      readonly from: string;
      readonly to: string;
      readonly wireIds: readonly string[];
    };

export interface ConsistencyFinding {
  readonly ruleId: string;
  readonly severity: 'warning' | 'info';
  readonly kind: 'consistency';
  readonly componentIds: readonly string[];
  readonly wireIds: readonly string[];
  readonly pinIds: readonly string[];
  /** `safety:<rule>`; the UI renders `<key>.title`, `.why`, `.fix` with `params`. */
  readonly messageKey: string;
  readonly params: Readonly<Record<string, string | number>>;
  readonly learnMoreSlug: string;
  readonly codeRefs: readonly CodeRef[];
  readonly fixes: readonly QuickFix[];
}

export const PIN_UNWIRED = 'SAF-PIN-UNWIRED';
export const PIN_UNUSED = 'SAF-PIN-UNUSED';
export const PIN_DIRECTION = 'SAF-PIN-DIRECTION';

/** Pins with something on the board itself: D13 drives the "L" LED. */
const ON_BOARD = new Set(['D13']);
const UART = new Set(['D0', 'D1']);
const I2C = new Set(['A4', 'A5']);
const SPI = new Set(['D10', 'D11', 'D12', 'D13']);

/** I²C device libraries: they only use A4/A5. */
const I2C_LIBRARIES = new Set([
  'Wire.h',
  'LiquidCrystal_I2C.h',
  'Adafruit_GFX.h',
  'Adafruit_SSD1306.h',
  'Adafruit_Sensor.h',
  'Adafruit_BMP280.h',
  'Adafruit_MPU6050.h',
  'Adafruit_VL53L0X.h',
  'Adafruit_I2CDevice.h',
]);

/**
 * Libraries whose pins the analysis knows: core ones, those with constructor pins (`libraryPins`) or pin
 * uses (`Servo.attach`, `DHT`), and the I²C device libraries.
 */
const KNOWN_INCLUDES = new Set([
  'Arduino.h',
  'EEPROM.h',
  'Servo.h',
  'DHT.h',
  'NewPing.h',
  'SoftwareSerial.h',
  'Stepper.h',
  'Adafruit_NeoPixel.h',
  'OneWire.h',
  'DallasTemperature.h',
  'SPI.h',
  ...I2C_LIBRARIES,
]);

const READS = new Set<PinUse['use']>(['digitalRead', 'analogRead']);
const isWrite = (u: PinUse): boolean =>
  u.mode === 'OUTPUT' ||
  u.use === 'digitalWrite' ||
  u.use === 'analogWrite' ||
  u.use === 'tone' ||
  u.use === 'servo' ||
  u.use === 'dht';
const isRead = (u: PinUse): boolean => READS.has(u.use) || u.mode === 'INPUT' || u.mode === 'INPUT_PULLUP';

/** How the sketch writes a board pin: D9 → `9`, A0 → `A0`. */
export const pinToken = (pin: string): string => pin.replace(/^D/, '');

/** Everything the sketch does with each pin. */
interface PinCode {
  readonly uses: PinUse[];
  readonly libs: LibraryPin[];
}

function codeByPin(code: CodeFacts): Map<string, PinCode> {
  const out = new Map<string, PinCode>();
  const of = (pin: string): PinCode => {
    let pc = out.get(pin);
    if (!pc) out.set(pin, (pc = { uses: [], libs: [] }));
    return pc;
  };
  for (const u of code.uses) of(u.pin).uses.push(u);
  for (const l of code.libraryPins ?? []) if (l.pin) of(l.pin).libs.push(l);
  return out;
}

/**
 * True when the analysis sees every pin the sketch touches: no unresolved pin calls or port registers,
 * every library pin constant, and only libraries whose pins are known.
 */
export function sketchIsComplete(code: CodeFacts): boolean {
  return (
    code.unresolved.length === 0 &&
    (code.libraryPins ?? []).every((l) => l.pin !== null) &&
    code.includes.every((i) => KNOWN_INCLUDES.has(i))
  );
}

/** Pins the sketch may use without naming them: the serial port, the I²C and SPI buses. */
function implicitPins(code: CodeFacts): Set<string> {
  const out = new Set<string>();
  if ((code.libraryPins ?? []).some((l) => l.lib === 'Serial')) for (const p of UART) out.add(p);
  if (code.includes.some((i) => I2C_LIBRARIES.has(i))) for (const p of I2C) out.add(p);
  if (code.includes.includes('SPI.h')) for (const p of SPI) out.add(p);
  return out;
}

/** Board capabilities the sketch needs from a pin (a fix may only move to a pin that has them). */
function needs(pc: PinCode): PinCapability[] {
  const out: PinCapability[] = ['digital'];
  if (pc.uses.some((u) => u.use === 'analogWrite')) out.push('pwm');
  if (pc.uses.some((u) => u.use === 'analogRead')) out.push('adc');
  return out;
}

const refsOf = (pc: PinCode): CodeRef[] => [...pc.uses.map((u) => u.at), ...pc.libs.map((l) => l.at)];

const base = (
  ruleId: string,
  severity: ConsistencyFinding['severity'],
  f: Pick<ConsistencyFinding, 'componentIds' | 'wireIds' | 'pinIds' | 'params' | 'codeRefs' | 'fixes'>,
): ConsistencyFinding => ({
  ruleId,
  severity,
  kind: 'consistency',
  messageKey: `safety:${ruleId}`,
  learnMoreSlug: ruleId.toLowerCase(),
  ...f,
});

/** Code edits that make the sketch use `to` instead of `from`, or null when a use has no editable span. */
function codeFix(pc: PinCode, from: string, to: string): QuickFix | null {
  if (pc.libs.length || pc.uses.some((u) => !u.arg)) return null;
  const seen = new Map<string, PinEdit>();
  for (const u of pc.uses) {
    const a = u.arg as PinArg;
    // A channel number (`analogRead(0)`) and a pin number both become the board name of `to`.
    seen.set(`${a.file}:${a.line}:${a.column}`, { ...a, replace: pinToken(to) });
  }
  return { kind: 'code.replacePin', from, to, edits: [...seen.values()] };
}

const wireFix = (view: BoardPinView, to: string): QuickFix | null =>
  view.boardWireIds.length ? { kind: 'wire.moveEnd', from: view.pin, to, wireIds: view.boardWireIds } : null;

const MAX_FIXES = 3;

/**
 * Findings of the three wiring ↔ sketch rules. `code` null (analysis still loading) gives none.
 * Order: unwired, direction, unused; each in board pin order.
 */
export function checkConsistency(
  pins: readonly BoardPinView[],
  code: CodeFacts | null,
): ConsistencyFinding[] {
  if (!code) return [];
  const byPin = codeByPin(code);
  const implicit = implicitPins(code);
  const views = new Map(pins.map((v) => [v.pin, v]));

  // A board pin a sketch pin could move to: wired to a part, used by nothing in the sketch.
  const idle = pins.filter((v) => v.peers.length > 0 && !byPin.has(v.pin) && !implicit.has(v.pin));
  // Sketch pins with nothing connected (seed-only and library-only pins have their own exemptions below).
  const unwired: string[] = [];
  for (const v of pins) {
    const pc = byPin.get(v.pin);
    if (!pc || v.connected || ON_BOARD.has(v.pin)) continue;
    if (pc.uses.length && pc.uses.every((u) => u.context === 'randomSeed') && !pc.libs.length) continue;
    if (!pc.uses.length && pc.libs.every((l) => l.lib === 'Serial')) continue;
    unwired.push(v.pin);
  }
  const fits = (pc: PinCode, v: BoardPinView): boolean => needs(pc).every((c) => v.capabilities.includes(c));

  const out: ConsistencyFinding[] = [];
  for (const pin of unwired) {
    const pc = byPin.get(pin) as PinCode;
    const fixes: QuickFix[] = [];
    for (const y of idle.filter((y) => fits(pc, y)).slice(0, MAX_FIXES)) {
      const c = codeFix(pc, pin, y.pin);
      const w = wireFix(y, pin);
      if (c) fixes.push(c);
      if (w) fixes.push(w);
    }
    out.push(
      base(PIN_UNWIRED, 'warning', {
        componentIds: [],
        wireIds: [],
        pinIds: [pin],
        params: { pin },
        codeRefs: refsOf(pc),
        fixes,
      }),
    );
  }

  for (const v of pins) {
    const pc = byPin.get(v.pin);
    if (!pc) continue;
    const seedOnly = (u: PinUse) => u.context === 'randomSeed';
    const reads =
      pc.uses.filter((u) => isRead(u) && !seedOnly(u)).length + pc.libs.filter((l) => l.role === 'in').length;
    const writes = pc.uses.some(isWrite) || pc.libs.some((l) => l.role !== 'in');
    if (!reads || writes) continue;
    const directed = v.peers.filter((p) => p.direction !== 'none');
    if (!directed.length || !directed.every((p) => p.direction === 'in')) continue;
    out.push(
      base(PIN_DIRECTION, 'warning', {
        componentIds: [...new Set(directed.map((p) => p.partId))],
        wireIds: v.wireIds,
        pinIds: [v.pin],
        params: { pin: v.pin, part: `${directed[0]?.partId}.${directed[0]?.pin}` },
        codeRefs: refsOf(pc),
        fixes: [],
      }),
    );
  }

  if (sketchIsComplete(code))
    for (const y of idle) {
      const fixes: QuickFix[] = [];
      for (const x of unwired) {
        const pc = byPin.get(x) as PinCode;
        if (fixes.length >= MAX_FIXES * 2 || !fits(pc, y)) continue;
        const c = codeFix(pc, x, y.pin);
        const w = wireFix(views.get(y.pin) as BoardPinView, x);
        if (c) fixes.push(c);
        if (w) fixes.push(w);
      }
      out.push(
        base(PIN_UNUSED, 'info', {
          componentIds: [...new Set(y.peers.map((p) => p.partId))],
          wireIds: y.wireIds,
          pinIds: [y.pin],
          params: { pin: y.pin, pinArg: pinToken(y.pin) },
          codeRefs: [],
          fixes,
        }),
      );
    }
  return out;
}

/**
 * Applies a `code.replacePin` fix to the sketch files. Throws when the text at a span is no longer the
 * pin token the fix was computed for (the code changed since), so a stale fix never edits the wrong text.
 */
export function applyPinEdits<F extends { readonly name: string; readonly content: string }>(
  files: readonly F[],
  edits: readonly PinEdit[],
): F[] {
  return files.map((f) => {
    const mine = edits
      .filter((e) => e.file === f.name)
      .sort((a, b) => b.line - a.line || b.column - a.column);
    if (!mine.length) return f;
    const lines = f.content.split('\n');
    for (const e of mine) {
      const line = lines[e.line - 1];
      if (line?.slice(e.column - 1, e.endColumn - 1) !== e.text)
        throw new Error(`stale pin edit at ${e.file}:${e.line}:${e.column}`);
      lines[e.line - 1] = line.slice(0, e.column - 1) + e.replace + line.slice(e.endColumn - 1);
    }
    return { ...f, content: lines.join('\n') };
  });
}
