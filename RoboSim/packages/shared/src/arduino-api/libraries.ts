/**
 * Libraries a sketch may include (FR-COD-07): the Arduino core's bundled ones and the pinned set of
 * `apps/compiler/toolchain.lock.json` (a compiler test keeps the two in step). Descriptions are i18n
 * keys `apidocs:library.<name>`.
 */
export interface ArduinoLibrary {
  /** Name as in the toolchain lock (core libraries: their folder name). */
  readonly name: string;
  readonly version: string;
  /** Headers "Add" inserts as `#include <…>`, in order. */
  readonly includes: readonly string[];
  /** Ships with the Arduino AVR core (not pinned separately). */
  readonly builtin: boolean;
}

const core = (name: string, version: string, includes = [`${name}.h`]): ArduinoLibrary => ({
  name,
  version,
  includes,
  builtin: true,
});
const pinned = (name: string, version: string, includes = [`${name}.h`]): ArduinoLibrary => ({
  name,
  version,
  includes,
  builtin: false,
});

export const ARDUINO_LIBRARIES: readonly ArduinoLibrary[] = [
  core('Wire', '1.0'),
  core('SPI', '1.0'),
  core('EEPROM', '2.0'),
  core('SoftwareSerial', '1.0'),
  pinned('Servo', '1.3.0'),
  pinned('NewPing', '1.9.7'),
  pinned('Stepper', '1.1.3'),
  pinned('Keypad', '3.1.1'),
  pinned('Adafruit_BusIO', '1.17.4', ['Adafruit_I2CDevice.h']),
  pinned('Adafruit_Sensor', '1.1.15'),
  pinned('Adafruit_GFX', '1.12.6'),
  pinned('Adafruit_SSD1306', '2.5.17', ['Wire.h', 'Adafruit_GFX.h', 'Adafruit_SSD1306.h']),
  pinned('Adafruit_MPU6050', '2.2.9', ['Wire.h', 'Adafruit_Sensor.h', 'Adafruit_MPU6050.h']),
  pinned('Adafruit_BMP280', '3.0.0', ['Wire.h', 'Adafruit_BMP280.h']),
  pinned('VL53L0X', '1.3.1', ['Wire.h', 'VL53L0X.h']),
  pinned('LiquidCrystal_I2C', '1.1.3', ['Wire.h', 'LiquidCrystal_I2C.h']),
  pinned('DHT', '1.4.7'),
  pinned('OneWire', 'v2.3.8'),
  pinned('DallasTemperature', 'v4.0.6', ['OneWire.h', 'DallasTemperature.h']),
  pinned('Adafruit_NeoPixel', '1.15.5'),
];

/**
 * Source with the library's `#include`s added after the last existing one (or at the top),
 * skipping headers already included. Returns the source unchanged when nothing is missing.
 */
export function addIncludes(source: string, library: ArduinoLibrary): string {
  const present = new Set([...source.matchAll(/^\s*#\s*include\s*[<"]([^>"]+)[>"]/gm)].map((m) => m[1]));
  const missing = library.includes.filter((h) => !present.has(h));
  if (missing.length === 0) return source;
  const lines = missing.map((h) => `#include <${h}>`);
  const last = [...source.matchAll(/^\s*#\s*include\b.*$/gm)].at(-1);
  if (!last) return `${lines.join('\n')}\n${source.startsWith('\n') ? '' : '\n'}${source}`;
  const end = (last.index ?? 0) + last[0].length;
  return `${source.slice(0, end)}\n${lines.join('\n')}${source.slice(end)}`;
}
