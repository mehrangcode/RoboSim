import { type ApiTable, constants, instance, method, type } from './model.js';

/** Wire 1.0 (AVR core, `Wire.h`): I²C. read/write/available/peek/flush come from `Stream`/`Print`. */
export const WIRE: ApiTable = {
  classes: [{ name: 'TwoWire', library: 'Wire', extends: ['Stream'], instances: ['Wire'] }],
  entries: [
    type('TwoWire', 'class TwoWire : public Stream', { doc: 'TwoWire.TwoWire' }),
    instance('Wire', 'TwoWire', 'TwoWire Wire'),
    method('TwoWire', 'begin', [], 'void', {
      overloads: ['void begin(uint8_t address)'],
      example:
        'Wire.begin();     // join the bus as controller\nWire.begin(0x08); // join as peripheral at 0x08',
    }),
    method('TwoWire', 'end', []),
    method('TwoWire', 'setClock', ['uint32_t clock'], 'void', {
      example: 'Wire.setClock(400000); // 400 kHz fast mode',
    }),
    method('TwoWire', 'setWireTimeout', ['uint32_t timeout = 25000', 'bool reset_with_timeout = false']),
    method('TwoWire', 'getWireTimeoutFlag', [], 'bool'),
    method('TwoWire', 'clearWireTimeoutFlag', []),
    method('TwoWire', 'beginTransmission', ['uint8_t address'], 'void', {
      example: 'Wire.beginTransmission(0x3C);\nWire.write(0x00);\nuint8_t error = Wire.endTransmission();',
    }),
    method('TwoWire', 'endTransmission', [], 'uint8_t', {
      overloads: ['uint8_t endTransmission(bool sendStop)'],
    }),
    method('TwoWire', 'requestFrom', ['uint8_t address', 'uint8_t quantity'], 'uint8_t', {
      overloads: [
        'uint8_t requestFrom(uint8_t address, uint8_t quantity, bool sendStop)',
        'uint8_t requestFrom(uint8_t address, uint8_t quantity, uint32_t iaddress, uint8_t isize, uint8_t sendStop)',
      ],
      example: 'Wire.requestFrom(0x68, 2);\nwhile (Wire.available()) {\n  byte b = Wire.read();\n}',
    }),
    method('TwoWire', 'onReceive', ['void (*handler)(int numBytes)'], 'void', {
      example:
        'void receiveEvent(int numBytes) {\n  while (Wire.available()) Serial.write(Wire.read());\n}\n\nvoid setup() {\n  Wire.begin(0x08);\n  Wire.onReceive(receiveEvent);\n}',
    }),
    method('TwoWire', 'onRequest', ['void (*handler)()'], 'void', {
      example:
        'void requestEvent() {\n  Wire.write("hi");\n}\n\nvoid setup() {\n  Wire.begin(0x08);\n  Wire.onRequest(requestEvent);\n}',
    }),
    ...constants(['BUFFER_LENGTH'], 'I²C buffer size (32 bytes)', 'TwoWire.BUFFER_LENGTH'),
  ],
};
