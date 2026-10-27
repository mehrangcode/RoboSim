import { type ApiTable, instance, method, type } from './model.js';

/** EEPROM 2.0 (AVR core, `EEPROM.h`). `EEPROM[address]` works too but is an operator, not a member. */
export const EEPROM: ApiTable = {
  classes: [{ name: 'EEPROMClass', library: 'EEPROM', instances: ['EEPROM'] }],
  entries: [
    type('EEPROMClass', 'struct EEPROMClass', { doc: 'EEPROMClass.EEPROMClass' }),
    instance('EEPROM', 'EEPROMClass', 'EEPROMClass EEPROM'),
    method('EEPROMClass', 'read', ['int address'], 'uint8_t', { example: 'byte value = EEPROM.read(0);' }),
    method('EEPROMClass', 'write', ['int address', 'uint8_t value'], 'void', {
      example: 'EEPROM.write(0, 42);',
    }),
    method('EEPROMClass', 'update', ['int address', 'uint8_t value'], 'void', {
      example: 'EEPROM.update(0, 42); // writes only if the value changed',
    }),
    method('EEPROMClass', 'get', ['int address', 'T &data'], 'T &', {
      example: 'float level;\nEEPROM.get(0, level);',
    }),
    method('EEPROMClass', 'put', ['int address', 'const T &data'], 'const T &', {
      example: 'float level = 3.5;\nEEPROM.put(0, level); // uses 4 bytes: 0–3',
    }),
    method('EEPROMClass', 'length', [], 'uint16_t', {
      example: 'for (int i = 0; i < EEPROM.length(); i++) {\n  EEPROM.update(i, 0);\n}',
    }),
  ],
};
