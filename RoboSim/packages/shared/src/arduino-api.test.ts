import { describe, expect, it } from 'vitest';
import {
  ARDUINO_API,
  ARDUINO_CLASSES,
  ARDUINO_LIBRARIES,
  addIncludes,
  classChain,
  declaredClass,
  lookupApi,
  membersOf,
} from './arduino-api.js';
import { paramName } from './arduino-api/model.js';

/** The value, or a failed test when it is missing. */
function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected a value');
  return value;
}

describe('Arduino API table (code editor)', () => {
  it('has unique entries per owner and snippets with numbered placeholders', () => {
    const keys = ARDUINO_API.map((e) => `${e.kind === 'method' || e.member ? (e.of ?? '') : ''}.${e.name}`);
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
    expect(ARDUINO_API.find((e) => e.name === 'analogWrite')?.insert).toBe(
      'analogWrite(${1:pin}, ${2:value})',
    );
  });

  it('names parameters from C declarations', () => {
    expect(paramName('uint8_t *buffer')).toBe('buffer');
    expect(paramName('void (*isr)()')).toBe('isr');
    expect(paramName('const char name[]')).toBe('name');
    expect(paramName('uint8_t mode = HIGH')).toBe('mode');
  });

  it('declares every class at most once and only known bases', () => {
    const names = ARDUINO_CLASSES.map((c) => c.name);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
    for (const c of ARDUINO_CLASSES) for (const base of c.extends ?? []) expect(names).toContain(base);
    for (const e of ARDUINO_API) if (e.kind === 'method') expect(names, e.detail).toContain(e.of);
  });

  it('resolves members through declarations and base classes', () => {
    expect(declaredClass('', 'Serial')).toBe('HardwareSerial');
    expect(declaredClass('Servo arm;\nvoid setup() { arm.attach(9); }', 'arm')).toBe('Servo');
    expect(declaredClass('Servo *p = &arm;', 'p')).toBe('Servo');
    expect(declaredClass('int arm;', 'arm')).toBeUndefined();
    expect(classChain('HardwareSerial')).toEqual(['HardwareSerial', 'Stream', 'Print']);
    expect(membersOf('HardwareSerial').map((e) => e.name)).toEqual(
      expect.arrayContaining(['begin', 'println', 'parseInt']),
    );
    expect(lookupApi('attach', { cls: 'Servo' })?.of).toBe('Servo');
    expect(lookupApi('attach', {})).toBeUndefined();
    expect(lookupApi('pinMode')?.kind).toBe('function');
    // Nested enums only through their class: `Adafruit_BMP280::MODE_NORMAL`.
    expect(lookupApi('MODE_NORMAL')).toBeUndefined();
    expect(lookupApi('MODE_NORMAL', { cls: 'Adafruit_BMP280' })?.member).toBe(true);
  });
});

describe('library includes (FR-COD-07)', () => {
  const lib = (name: string) => must(ARDUINO_LIBRARIES.find((l) => l.name === name));

  it('adds missing includes after the last one, keeping existing ones', () => {
    const src = '#include <Wire.h>\n\nvoid setup() {}\n';
    expect(addIncludes(src, lib('LiquidCrystal_I2C'))).toBe(
      '#include <Wire.h>\n#include <LiquidCrystal_I2C.h>\n\nvoid setup() {}\n',
    );
    expect(addIncludes('void setup() {}\n', lib('Servo'))).toBe('#include <Servo.h>\n\nvoid setup() {}\n');
    expect(addIncludes(src, lib('Wire'))).toBe(src);
  });
});
