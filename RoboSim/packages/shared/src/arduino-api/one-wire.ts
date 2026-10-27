import { type ApiTable, cls, method } from './model.js';

const O = 'OneWire';

/** OneWire 2.3.8 (`OneWire.h`): the 1-Wire bus used by DS18B20 sensors. */
export const ONE_WIRE: ApiTable = {
  classes: [{ name: O, library: 'OneWire' }],
  entries: [
    cls(O, ['OneWire()', 'OneWire(uint8_t pin)'], {
      example: 'OneWire ds(2); // bus on pin 2, 4.7 kΩ pull-up to 5 V',
    }),
    method(O, 'begin', ['uint8_t pin']),
    method(O, 'reset', [], 'uint8_t'),
    method(O, 'select', ['const uint8_t rom[8]'], 'void', {
      example: 'ds.reset();\nds.select(addr);\nds.write(0x44); // start conversion',
    }),
    method(O, 'skip', []),
    method(O, 'write', ['uint8_t v', 'uint8_t power = 0'], 'void', {
      example: 'ds.write(0xBE); // read scratchpad',
    }),
    method(O, 'write_bytes', ['const uint8_t *buf', 'uint16_t count', 'bool power = 0']),
    method(O, 'read', [], 'uint8_t'),
    method(O, 'read_bytes', ['uint8_t *buf', 'uint16_t count'], 'void', {
      example: 'uint8_t data[9];\nds.read_bytes(data, 9);',
    }),
    method(O, 'write_bit', ['uint8_t v']),
    method(O, 'read_bit', [], 'uint8_t'),
    method(O, 'depower', []),
    method(O, 'search', ['uint8_t *newAddr', 'bool search_mode = true'], 'bool', {
      example: 'uint8_t addr[8];\nwhile (ds.search(addr)) {\n  // found a device\n}\nds.reset_search();',
    }),
    method(O, 'reset_search', []),
    method(O, 'target_search', ['uint8_t family_code'], 'void', {
      example: 'ds.target_search(0x28); // DS18B20 only',
    }),
    method(O, 'crc8', ['const uint8_t *addr', 'uint8_t len'], 'static uint8_t', {
      example: 'if (OneWire::crc8(addr, 7) != addr[7]) Serial.println("bad CRC");',
    }),
    method(O, 'crc16', ['const uint8_t *input', 'uint16_t len', 'uint16_t crc = 0'], 'static uint16_t'),
    method(
      O,
      'check_crc16',
      ['const uint8_t *input', 'uint16_t len', 'const uint8_t *inverted_crc', 'uint16_t crc = 0'],
      'static bool',
    ),
  ],
};
