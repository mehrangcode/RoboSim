/**
 * Arduino core and allow-listed library API for the code editor (Technical Design §4): highlighting
 * and basic completions. `insert` is a snippet (`${1:name}` placeholders); `detail` is the
 * signature. English only for now; translated hover docs come with FR-COD-02 (P2).
 */
export interface ArduinoApiEntry {
  readonly name: string;
  readonly kind: 'function' | 'constant' | 'type' | 'method';
  readonly detail: string;
  readonly insert?: string;
  /** For methods: the object or class they belong to. */
  readonly of?: 'Serial' | 'Servo' | 'NewPing' | 'Stepper' | 'Keypad' | 'String';
}

const fn = (name: string, params: readonly string[], ret = 'void'): ArduinoApiEntry => ({
  name,
  kind: 'function',
  detail: `${ret} ${name}(${params.join(', ')})`,
  insert: `${name}(${params.map((p, i) => `\${${i + 1}:${p.split(' ').at(-1) ?? p}}`).join(', ')})`,
});

const method = (
  of: NonNullable<ArduinoApiEntry['of']>,
  name: string,
  params: readonly string[],
  ret = 'void',
): ArduinoApiEntry => ({
  ...fn(name, params, ret),
  kind: 'method',
  of,
  detail: `${ret} ${of}.${name}(${params.join(', ')})`,
});

const constants = (names: readonly string[], detail: string): ArduinoApiEntry[] =>
  names.map((name) => ({ name, kind: 'constant', detail }));

const types = (names: readonly string[]): ArduinoApiEntry[] =>
  names.map((name) => ({ name, kind: 'type', detail: name }));

export const ARDUINO_API: readonly ArduinoApiEntry[] = [
  // Digital and analog I/O
  fn('pinMode', ['uint8_t pin', 'uint8_t mode']),
  fn('makeKeymap', ['keys'], 'char*'),
  fn('digitalWrite', ['uint8_t pin', 'uint8_t value']),
  fn('digitalRead', ['uint8_t pin'], 'int'),
  fn('analogRead', ['uint8_t pin'], 'int'),
  fn('analogWrite', ['uint8_t pin', 'int value']),
  fn('analogReference', ['uint8_t mode']),
  // Time
  fn('delay', ['unsigned long ms']),
  fn('delayMicroseconds', ['unsigned int us']),
  fn('millis', [], 'unsigned long'),
  fn('micros', [], 'unsigned long'),
  // Advanced I/O
  fn('pulseIn', ['uint8_t pin', 'uint8_t state', 'unsigned long timeout'], 'unsigned long'),
  fn('pulseInLong', ['uint8_t pin', 'uint8_t state', 'unsigned long timeout'], 'unsigned long'),
  fn('shiftOut', ['uint8_t dataPin', 'uint8_t clockPin', 'uint8_t bitOrder', 'uint8_t value']),
  fn('shiftIn', ['uint8_t dataPin', 'uint8_t clockPin', 'uint8_t bitOrder'], 'uint8_t'),
  fn('tone', ['uint8_t pin', 'unsigned int frequency', 'unsigned long duration']),
  fn('noTone', ['uint8_t pin']),
  // Interrupts
  fn('attachInterrupt', ['uint8_t interrupt', 'void (*isr)()', 'int mode']),
  fn('detachInterrupt', ['uint8_t interrupt']),
  fn('digitalPinToInterrupt', ['uint8_t pin'], 'int'),
  fn('interrupts', []),
  fn('noInterrupts', []),
  // Math
  fn('map', ['long value', 'long fromLow', 'long fromHigh', 'long toLow', 'long toHigh'], 'long'),
  fn('constrain', ['x', 'low', 'high']),
  fn('min', ['a', 'b']),
  fn('max', ['a', 'b']),
  fn('abs', ['x']),
  fn('sq', ['x']),
  fn('sqrt', ['double x'], 'double'),
  fn('pow', ['double base', 'double exponent'], 'double'),
  fn('sin', ['double rad'], 'double'),
  fn('cos', ['double rad'], 'double'),
  fn('tan', ['double rad'], 'double'),
  fn('random', ['long min', 'long max'], 'long'),
  fn('randomSeed', ['unsigned long seed']),
  // Bits and bytes
  fn('bitRead', ['x', 'n']),
  fn('bitWrite', ['x', 'n', 'b']),
  fn('bitSet', ['x', 'n']),
  fn('bitClear', ['x', 'n']),
  fn('bit', ['n']),
  fn('highByte', ['x'], 'uint8_t'),
  fn('lowByte', ['x'], 'uint8_t'),
  // Sketch structure
  { name: 'setup', kind: 'function', detail: 'void setup()', insert: 'void setup() {\n\t$0\n}' },
  { name: 'loop', kind: 'function', detail: 'void loop()', insert: 'void loop() {\n\t$0\n}' },

  ...constants(['HIGH', 'LOW'], 'pin level'),
  ...constants(['INPUT', 'OUTPUT', 'INPUT_PULLUP'], 'pin mode'),
  ...constants(['LED_BUILTIN'], 'on-board LED pin (13 on the Uno)'),
  ...constants(['A0', 'A1', 'A2', 'A3', 'A4', 'A5'], 'analog input pin'),
  ...constants(['CHANGE', 'RISING', 'FALLING'], 'interrupt mode'),
  ...constants(['LSBFIRST', 'MSBFIRST'], 'bit order'),
  ...constants(['DEFAULT', 'INTERNAL', 'EXTERNAL'], 'analog reference'),
  ...constants(['DEC', 'HEX', 'OCT', 'BIN'], 'number base for print'),
  ...constants(['PI', 'HALF_PI', 'TWO_PI', 'DEG_TO_RAD', 'RAD_TO_DEG'], 'math constant'),

  ...types(['boolean', 'byte', 'word', 'String', 'Servo', 'NewPing', 'Stepper', 'Keypad', 'size_t']),
  ...types(['int8_t', 'uint8_t', 'int16_t', 'uint16_t', 'int32_t', 'uint32_t']),
  { name: 'Serial', kind: 'constant', detail: 'HardwareSerial Serial (USB serial port)' },

  method('Serial', 'begin', ['unsigned long baud']),
  method('Serial', 'end', []),
  method('Serial', 'print', ['value'], 'size_t'),
  method('Serial', 'println', ['value'], 'size_t'),
  method('Serial', 'write', ['uint8_t byte'], 'size_t'),
  method('Serial', 'available', [], 'int'),
  method('Serial', 'read', [], 'int'),
  method('Serial', 'peek', [], 'int'),
  method('Serial', 'flush', []),
  method('Serial', 'readString', [], 'String'),
  method('Serial', 'readStringUntil', ['char terminator'], 'String'),
  method('Serial', 'parseInt', [], 'long'),
  method('Serial', 'parseFloat', [], 'float'),
  method('Serial', 'setTimeout', ['unsigned long ms']),

  method('Servo', 'attach', ['int pin'], 'uint8_t'),
  method('Servo', 'write', ['int angle']),
  method('Servo', 'writeMicroseconds', ['int us']),
  method('Servo', 'read', [], 'int'),
  method('Servo', 'attached', [], 'bool'),
  method('Servo', 'detach', []),

  method('NewPing', 'ping_cm', [], 'unsigned long'),
  method('NewPing', 'ping_in', [], 'unsigned long'),
  method('NewPing', 'ping', [], 'unsigned long'),
  method('NewPing', 'ping_median', ['uint8_t iterations'], 'unsigned long'),
  method('NewPing', 'convert_cm', ['unsigned long echoTime'], 'unsigned long'),

  method('Stepper', 'setSpeed', ['long rpm']),
  method('Stepper', 'step', ['int steps']),

  method('Keypad', 'getKey', [], 'char'),
  method('Keypad', 'waitForKey', [], 'char'),
  method('Keypad', 'isPressed', ['char key'], 'bool'),
  method('Keypad', 'setDebounceTime', ['unsigned int ms']),
  method('Keypad', 'setHoldTime', ['unsigned int ms']),

  method('String', 'length', [], 'unsigned int'),
  method('String', 'toInt', [], 'long'),
  method('String', 'toFloat', [], 'float'),
  method('String', 'trim', []),
  method('String', 'indexOf', ['String value'], 'int'),
  method('String', 'substring', ['unsigned int from', 'unsigned int to'], 'String'),
  method('String', 'equals', ['String other'], 'bool'),
  method('String', 'toUpperCase', []),
  method('String', 'toLowerCase', []),
];
