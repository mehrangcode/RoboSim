import { type ApiTable, cls, method } from './model.js';

/** SoftwareSerial 1.0 (AVR core, `SoftwareSerial.h`). read/write/available/peek/flush come from `Stream`/`Print`. */
export const SOFTWARE_SERIAL: ApiTable = {
  classes: [{ name: 'SoftwareSerial', library: 'SoftwareSerial', extends: ['Stream'] }],
  entries: [
    cls(
      'SoftwareSerial',
      ['SoftwareSerial(uint8_t receivePin, uint8_t transmitPin, bool inverse_logic = false)'],
      {
        example: 'SoftwareSerial bt(2, 3); // RX, TX\n\nvoid setup() {\n  bt.begin(9600);\n}',
      },
    ),
    method('SoftwareSerial', 'begin', ['long speed'], 'void', { example: 'bt.begin(9600);' }),
    method('SoftwareSerial', 'end', []),
    method('SoftwareSerial', 'listen', [], 'bool', {
      example: 'gps.listen(); // only one port receives at a time',
    }),
    method('SoftwareSerial', 'isListening', [], 'bool'),
    method('SoftwareSerial', 'stopListening', [], 'bool'),
    method('SoftwareSerial', 'overflow', [], 'bool'),
  ],
};
