/**
 * Arduino core and allow-listed library API for the code editor (Technical Design §4): highlighting,
 * completions and hover docs (FR-COD-02). Tables per library in `./arduino-api/`; docs in the UI
 * language come from the `apidocs` i18n namespace under `docKey(entry)`.
 */
import { CORE } from './arduino-api/core.js';
import { ADAFRUIT_BMP280 } from './arduino-api/adafruit-bmp280.js';
import { ADAFRUIT_BUSIO } from './arduino-api/adafruit-busio.js';
import { ADAFRUIT_GFX } from './arduino-api/adafruit-gfx.js';
import { ADAFRUIT_MPU6050 } from './arduino-api/adafruit-mpu6050.js';
import { ADAFRUIT_NEOPIXEL } from './arduino-api/adafruit-neopixel.js';
import { ADAFRUIT_SENSOR } from './arduino-api/adafruit-sensor.js';
import { ADAFRUIT_SSD1306 } from './arduino-api/adafruit-ssd1306.js';
import { DALLAS_TEMPERATURE } from './arduino-api/dallas-temperature.js';
import { DHT } from './arduino-api/dht.js';
import { EEPROM } from './arduino-api/eeprom.js';
import { KEYPAD } from './arduino-api/keypad.js';
import { LIQUID_CRYSTAL_I2C } from './arduino-api/liquid-crystal-i2c.js';
import type { ApiTable, ArduinoApiEntry, ArduinoClass } from './arduino-api/model.js';
import { NEW_PING } from './arduino-api/new-ping.js';
import { ONE_WIRE } from './arduino-api/one-wire.js';
import { SERVO } from './arduino-api/servo.js';
import { SOFTWARE_SERIAL } from './arduino-api/software-serial.js';
import { SPI } from './arduino-api/spi.js';
import { STEPPER } from './arduino-api/stepper.js';
import { VL53L0X } from './arduino-api/vl53l0x.js';
import { WIRE } from './arduino-api/wire.js';

export type { ApiTable, ArduinoApiEntry, ArduinoClass } from './arduino-api/model.js';
export { ARDUINO_LIBRARIES, addIncludes, type ArduinoLibrary } from './arduino-api/libraries.js';

const TABLES: readonly ApiTable[] = [
  CORE,
  WIRE,
  SPI,
  EEPROM,
  SOFTWARE_SERIAL,
  SERVO,
  NEW_PING,
  STEPPER,
  KEYPAD,
  ADAFRUIT_BUSIO,
  ADAFRUIT_SENSOR,
  ADAFRUIT_GFX,
  ADAFRUIT_SSD1306,
  ADAFRUIT_MPU6050,
  ADAFRUIT_BMP280,
  VL53L0X,
  LIQUID_CRYSTAL_I2C,
  DHT,
  ONE_WIRE,
  DALLAS_TEMPERATURE,
  ADAFRUIT_NEOPIXEL,
];

export const ARDUINO_API: readonly ArduinoApiEntry[] = TABLES.flatMap((t) => t.entries);
export const ARDUINO_CLASSES: readonly ArduinoClass[] = TABLES.flatMap((t) => t.classes);

const CLASS_BY_NAME = new Map(ARDUINO_CLASSES.map((c) => [c.name, c]));

/** i18n key (namespace `apidocs`) of an entry's doc. */
export const docKey = (e: ArduinoApiEntry): string => e.doc ?? `${e.of ?? 'core'}.${e.name}`;

/** The class and its bases, nearest first. */
export function classChain(name: string): string[] {
  const out: string[] = [];
  const queue = [name];
  while (queue.length > 0) {
    const next = queue.shift() as string;
    if (out.includes(next)) continue;
    out.push(next);
    queue.push(...(CLASS_BY_NAME.get(next)?.extends ?? []));
  }
  return out;
}

/** Methods and scoped constants of `cls` (own first; a base's same-named member is hidden). */
export function membersOf(cls: string): ArduinoApiEntry[] {
  const seen = new Set<string>();
  const out: ArduinoApiEntry[] = [];
  for (const c of classChain(cls))
    for (const e of ARDUINO_API)
      if ((e.kind === 'method' || e.member) && e.of === c && !seen.has(e.name)) {
        seen.add(e.name);
        out.push(e);
      }
  return out;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Class of `ident` in `source`: a global instance (`Serial`), else the nearest preceding declaration
 * `Type ident`, `Type ident(...)`, `Type *ident` or `Type ident = ...` of a known class.
 */
export function declaredClass(source: string, ident: string): string | undefined {
  const global = ARDUINO_CLASSES.find((c) => c.instances?.includes(ident));
  if (global) return global.name;
  const names = ARDUINO_CLASSES.map((c) => escape(c.name)).join('|');
  const decl = new RegExp(`\\b(${names})\\b\\s*(?:<[^>;]*>)?\\s*[*&]?\\s*\\b${escape(ident)}\\b`, 'g');
  return [...source.matchAll(decl)].at(-1)?.[1];
}

/** Whether `name` is a known class (so `Cls::` and `Cls x` resolve). */
export const isArduinoClass = (name: string): boolean => CLASS_BY_NAME.has(name);

/**
 * The entry a word refers to: a member of `owner`'s class when it follows `owner.` / `owner->`,
 * otherwise a top-level function, constant or type.
 */
export function lookupApi(word: string, owner?: { cls?: string }): ArduinoApiEntry | undefined {
  if (owner) return owner.cls ? membersOf(owner.cls).find((e) => e.name === word) : undefined;
  return ARDUINO_API.find((e) => e.kind !== 'method' && !e.member && e.name === word);
}
