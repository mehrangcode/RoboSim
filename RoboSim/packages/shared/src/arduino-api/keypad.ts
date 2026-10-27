import { type ApiTable, cls, constants, fn, method, type } from './model.js';

/** Keypad 3.1.1 (`Keypad.h`, `Key.h`). The `Key` base and its fields are internal and not listed. */
export const KEYPAD: ApiTable = {
  classes: [{ name: 'Keypad', library: 'Keypad' }],
  entries: [
    cls('Keypad', ['Keypad(char *userKeymap, byte *rowPins, byte *colPins, byte numRows, byte numCols)'], {
      example:
        "const byte ROWS = 4, COLS = 4;\nchar keys[ROWS][COLS] = {\n  {'1', '2', '3', 'A'},\n  {'4', '5', '6', 'B'},\n  {'7', '8', '9', 'C'},\n  {'*', '0', '#', 'D'},\n};\nbyte rowPins[ROWS] = {9, 8, 7, 6};\nbyte colPins[COLS] = {5, 4, 3, 2};\nKeypad keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);",
    }),
    fn('makeKeymap', ['char keys[][COLS]'], 'char *', {
      doc: 'Keypad.makeKeymap',
      example: 'Keypad keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);',
    }),
    method('Keypad', 'getKey', [], 'char', {
      example: 'char key = keypad.getKey();\nif (key != NO_KEY) {\n  Serial.println(key);\n}',
    }),
    method('Keypad', 'getKeys', [], 'bool'),
    method('Keypad', 'getState', [], 'KeyState'),
    method('Keypad', 'begin', ['char *userKeymap']),
    method('Keypad', 'isPressed', ['char keyChar'], 'bool'),
    method('Keypad', 'setDebounceTime', ['uint ms']),
    method('Keypad', 'setHoldTime', ['uint ms'], 'void', {
      example: 'keypad.setHoldTime(1000); // HOLD after 1 s',
    }),
    method('Keypad', 'addEventListener', ['void (*listener)(char)'], 'void', {
      example:
        'void keypadEvent(KeypadEvent key) {\n  if (keypad.getState() == PRESSED) Serial.println(key);\n}\n\nvoid setup() {\n  keypad.addEventListener(keypadEvent);\n}',
    }),
    method('Keypad', 'findInList', ['char keyChar'], 'int', { overloads: ['int findInList(int keyCode)'] }),
    method('Keypad', 'waitForKey', [], 'char'),
    method('Keypad', 'keyStateChanged', [], 'bool'),
    method('Keypad', 'numKeys', [], 'byte'),
    type('KeyState', 'enum KeyState { IDLE, PRESSED, HOLD, RELEASED }', { doc: 'Keypad.KeyState' }),
    type('KeypadEvent', 'typedef char KeypadEvent', { doc: 'Keypad.KeypadEvent' }),
    ...constants(['IDLE', 'PRESSED', 'HOLD', 'RELEASED'], 'KeyState', 'Keypad.states'),
    ...constants(['NO_KEY'], "char: no key pressed ('\\0')", 'Keypad.NO_KEY'),
  ],
};
