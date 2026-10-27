import { type ApiTable, cls, constants, fn, instance, method, type } from './model.js';

/** Overloads of `print`/`println` (`Print.h`); `name` is the method. */
const printOverloads = (name: string) => [
  `size_t ${name}(const char value[])`,
  `size_t ${name}(char value)`,
  `size_t ${name}(int value, int base = DEC)`,
  `size_t ${name}(unsigned int value, int base = DEC)`,
  `size_t ${name}(long value, int base = DEC)`,
  `size_t ${name}(unsigned long value, int base = DEC)`,
  `size_t ${name}(unsigned char value, int base = DEC)`,
  `size_t ${name}(double value, int digits = 2)`,
  `size_t ${name}(const __FlashStringHelper *value)`,
  `size_t ${name}(const Printable &value)`,
];

/** Arduino AVR core 1.8 as a sketch sees it (`Arduino.h`, `WCharacter.h`, `WString.h`, `Print.h`, `Stream.h`, `HardwareSerial.h`). */
export const CORE: ApiTable = {
  classes: [
    { name: 'Print', library: null },
    { name: 'Stream', library: null, extends: ['Print'] },
    { name: 'HardwareSerial', library: null, extends: ['Stream'], instances: ['Serial'] },
    { name: 'String', library: null },
  ],
  entries: [
    // Sketch structure
    fn('setup', [], 'void', { insert: 'void setup() {\n\t$0\n}' }),
    fn('loop', [], 'void', { insert: 'void loop() {\n\t$0\n}' }),
    fn('serialEvent', [], 'void', { insert: 'void serialEvent() {\n\t$0\n}' }),

    // Digital and analog I/O
    fn('pinMode', ['uint8_t pin', 'uint8_t mode'], 'void', {
      example: 'pinMode(LED_BUILTIN, OUTPUT);\npinMode(2, INPUT_PULLUP); // button to GND',
    }),
    fn('digitalWrite', ['uint8_t pin', 'uint8_t value'], 'void', {
      example: 'digitalWrite(LED_BUILTIN, HIGH);',
    }),
    fn('digitalRead', ['uint8_t pin'], 'int', {
      example: 'if (digitalRead(2) == LOW) {\n  // button pressed\n}',
    }),
    fn('analogRead', ['uint8_t pin'], 'int', {
      example: 'int raw = analogRead(A0);       // 0–1023\nfloat volts = raw * 5.0 / 1023;',
    }),
    fn('analogWrite', ['uint8_t pin', 'int value'], 'void', {
      example: 'analogWrite(9, 128); // ~50% brightness',
    }),
    fn('analogReference', ['uint8_t mode']),

    // Time
    fn('delay', ['unsigned long ms'], 'void', { example: 'delay(500); // wait half a second' }),
    fn('delayMicroseconds', ['unsigned int us']),
    fn('millis', [], 'unsigned long', {
      example:
        'unsigned long last = 0;\n\nvoid loop() {\n  if (millis() - last >= 1000) {\n    last = millis();\n    // runs once a second\n  }\n}',
    }),
    fn('micros', [], 'unsigned long'),
    fn('yield', []),

    // Advanced I/O
    fn('pulseIn', ['uint8_t pin', 'uint8_t state', 'unsigned long timeout = 1000000'], 'unsigned long', {
      example: 'unsigned long us = pulseIn(7, HIGH); // echo pulse length',
    }),
    fn('pulseInLong', ['uint8_t pin', 'uint8_t state', 'unsigned long timeout = 1000000'], 'unsigned long'),
    fn('shiftOut', ['uint8_t dataPin', 'uint8_t clockPin', 'uint8_t bitOrder', 'uint8_t value'], 'void', {
      example:
        'digitalWrite(latchPin, LOW);\nshiftOut(dataPin, clockPin, MSBFIRST, 0b10101010);\ndigitalWrite(latchPin, HIGH);',
    }),
    fn('shiftIn', ['uint8_t dataPin', 'uint8_t clockPin', 'uint8_t bitOrder'], 'uint8_t'),
    fn('tone', ['uint8_t pin', 'unsigned int frequency', 'unsigned long duration = 0'], 'void', {
      example: 'tone(8, 440, 200); // A4 for 200 ms',
    }),
    fn('noTone', ['uint8_t pin']),

    // Interrupts
    fn('attachInterrupt', ['uint8_t interrupt', 'void (*isr)()', 'int mode'], 'void', {
      example:
        'volatile int count = 0;\nvoid onPulse() { count++; }\n\nvoid setup() {\n  attachInterrupt(digitalPinToInterrupt(2), onPulse, RISING);\n}',
    }),
    fn('detachInterrupt', ['uint8_t interrupt']),
    fn('digitalPinToInterrupt', ['uint8_t pin'], 'int'),
    fn('interrupts', []),
    fn('noInterrupts', []),

    // Math
    fn('map', ['long value', 'long fromLow', 'long fromHigh', 'long toLow', 'long toHigh'], 'long', {
      example: 'int angle = map(analogRead(A0), 0, 1023, 0, 180);',
    }),
    fn('constrain', ['x', 'low', 'high'], 'T', { example: 'speed = constrain(speed, 0, 255);' }),
    fn('min', ['a', 'b'], 'T'),
    fn('max', ['a', 'b'], 'T'),
    fn('abs', ['x'], 'T'),
    fn('sq', ['x'], 'T'),
    fn('round', ['x'], 'long'),
    fn('sqrt', ['double x'], 'double'),
    fn('pow', ['double base', 'double exponent'], 'double'),
    fn('exp', ['double x'], 'double'),
    fn('log', ['double x'], 'double'),
    fn('log10', ['double x'], 'double'),
    fn('floor', ['double x'], 'double'),
    fn('ceil', ['double x'], 'double'),
    fn('fabs', ['double x'], 'double'),
    fn('sin', ['double rad'], 'double'),
    fn('cos', ['double rad'], 'double'),
    fn('tan', ['double rad'], 'double'),
    fn('asin', ['double x'], 'double'),
    fn('acos', ['double x'], 'double'),
    fn('atan', ['double x'], 'double'),
    fn('atan2', ['double y', 'double x'], 'double'),
    fn('radians', ['deg'], 'double'),
    fn('degrees', ['rad'], 'double'),
    fn('random', ['long min', 'long max'], 'long', {
      overloads: ['long random(long max)'],
      example: 'randomSeed(analogRead(A5)); // unconnected pin\nint dice = random(1, 7);    // 1–6',
    }),
    fn('randomSeed', ['unsigned long seed']),

    // Bits and bytes
    fn('bitRead', ['x', 'n'], 'int'),
    fn('bitWrite', ['x', 'n', 'b']),
    fn('bitSet', ['x', 'n']),
    fn('bitClear', ['x', 'n']),
    fn('bitToggle', ['x', 'n']),
    fn('bit', ['n'], 'unsigned long'),
    fn('highByte', ['x'], 'uint8_t'),
    fn('lowByte', ['x'], 'uint8_t'),
    fn('makeWord', ['byte high', 'byte low'], 'uint16_t', { overloads: ['uint16_t makeWord(uint16_t w)'] }),

    // Characters (WCharacter.h)
    fn('isAlpha', ['int c'], 'bool'),
    fn('isAlphaNumeric', ['int c'], 'bool'),
    fn('isAscii', ['int c'], 'bool'),
    fn('isControl', ['int c'], 'bool'),
    fn('isDigit', ['int c'], 'bool'),
    fn('isGraph', ['int c'], 'bool'),
    fn('isHexadecimalDigit', ['int c'], 'bool'),
    fn('isLowerCase', ['int c'], 'bool'),
    fn('isUpperCase', ['int c'], 'bool'),
    fn('isPrintable', ['int c'], 'bool'),
    fn('isPunct', ['int c'], 'bool'),
    fn('isSpace', ['int c'], 'bool'),
    fn('isWhitespace', ['int c'], 'bool'),
    fn('toAscii', ['int c'], 'int'),
    fn('toLowerCase', ['int c'], 'int'),
    fn('toUpperCase', ['int c'], 'int'),

    // Flash strings
    fn('F', ['const char text[]'], 'const __FlashStringHelper *', {
      insert: 'F("${1:text}")',
      example: 'Serial.println(F("Hello from flash memory"));',
    }),

    // Constants
    ...constants(['HIGH', 'LOW'], 'pin level (HIGH = 1, LOW = 0)', 'core.pinLevel'),
    ...constants(['INPUT', 'OUTPUT', 'INPUT_PULLUP'], 'pin mode', 'core.pinModes'),
    ...constants(['LED_BUILTIN'], 'on-board LED pin (13 on the Uno)', 'core.LED_BUILTIN'),
    ...constants(
      ['A0', 'A1', 'A2', 'A3', 'A4', 'A5'],
      'analog input pin (14–19 on the Uno)',
      'core.analogPin',
    ),
    ...constants(['CHANGE', 'RISING', 'FALLING'], 'interrupt mode', 'core.interruptMode'),
    ...constants(['LSBFIRST', 'MSBFIRST'], 'bit order', 'core.bitOrder'),
    ...constants(['DEFAULT', 'INTERNAL', 'EXTERNAL'], 'analog reference', 'core.analogReferenceMode'),
    ...constants(['DEC', 'HEX', 'OCT', 'BIN'], 'number base for print', 'core.numberBase'),
    ...constants(
      ['PI', 'HALF_PI', 'TWO_PI', 'DEG_TO_RAD', 'RAD_TO_DEG', 'EULER'],
      'math constant',
      'core.mathConstant',
    ),
    ...constants(
      [5, 6, 7, 8].flatMap((bits) =>
        ['N', 'E', 'O'].flatMap((parity) => [1, 2].map((stop) => `SERIAL_${bits}${parity}${stop}`)),
      ),
      'serial frame format: data bits, parity (N/E/O), stop bits',
      'core.serialConfig',
    ),
    ...constants(
      ['SKIP_ALL', 'SKIP_NONE', 'SKIP_WHITESPACE'],
      'LookaheadMode for parseInt/parseFloat',
      'Stream.lookahead',
    ),

    // Types
    type('boolean', 'typedef bool boolean'),
    type('byte', 'typedef uint8_t byte'),
    type('word', 'typedef unsigned int word\nuint16_t word(byte high, byte low)'),
    type('size_t', 'typedef unsigned int size_t'),
    type('int8_t'),
    type('uint8_t'),
    type('int16_t'),
    type('uint16_t'),
    type('int32_t'),
    type('uint32_t'),
    type('int64_t'),
    type('uint64_t'),

    // Print
    method('Print', 'print', ['const String &value'], 'size_t', {
      overloads: printOverloads('print'),
      example: 'Serial.print("T = ");\nSerial.print(23.456, 1); // 23.5\nSerial.print(255, HEX);  // FF',
    }),
    method('Print', 'println', ['const String &value'], 'size_t', {
      overloads: ['size_t println()', ...printOverloads('println')],
      example: 'Serial.println("Hello");\nSerial.println(analogRead(A0));',
    }),
    method('Print', 'write', ['uint8_t value'], 'size_t', {
      overloads: [
        'size_t write(const char *str)',
        'size_t write(const uint8_t *buffer, size_t size)',
        'size_t write(const char *buffer, size_t size)',
      ],
      example: 'Serial.write(65);      // sends the byte \'A\'\nSerial.write("raw");',
    }),
    method('Print', 'getWriteError', [], 'int'),
    method('Print', 'clearWriteError', []),

    // Stream
    method('Stream', 'available', [], 'int', {
      example: 'if (Serial.available() > 0) {\n  char c = Serial.read();\n}',
    }),
    method('Stream', 'read', [], 'int'),
    method('Stream', 'peek', [], 'int'),
    method('Stream', 'setTimeout', ['unsigned long timeout']),
    method('Stream', 'getTimeout', [], 'unsigned long'),
    method('Stream', 'find', ['char *target'], 'bool', {
      overloads: ['bool find(char *target, size_t length)', 'bool find(char target)'],
    }),
    method('Stream', 'findUntil', ['char *target', 'char *terminator'], 'bool', {
      overloads: ['bool findUntil(char *target, size_t targetLen, char *terminator, size_t termLen)'],
    }),
    method(
      'Stream',
      'parseInt',
      ['LookaheadMode lookahead = SKIP_ALL', 'char ignore = NO_IGNORE_CHAR'],
      'long',
      {
        overloads: ['long parseInt(char ignore)'],
        example: '// Serial Monitor sends "120\\n"\nlong n = Serial.parseInt(); // 120',
      },
    ),
    method(
      'Stream',
      'parseFloat',
      ['LookaheadMode lookahead = SKIP_ALL', 'char ignore = NO_IGNORE_CHAR'],
      'float',
      {
        overloads: ['float parseFloat(char ignore)'],
      },
    ),
    method('Stream', 'readBytes', ['char *buffer', 'size_t length'], 'size_t', {
      overloads: ['size_t readBytes(uint8_t *buffer, size_t length)'],
    }),
    method('Stream', 'readBytesUntil', ['char terminator', 'char *buffer', 'size_t length'], 'size_t', {
      overloads: ['size_t readBytesUntil(char terminator, uint8_t *buffer, size_t length)'],
    }),
    method('Stream', 'readString', [], 'String'),
    method('Stream', 'readStringUntil', ['char terminator'], 'String', {
      example: "String line = Serial.readStringUntil('\\n');",
    }),

    // HardwareSerial
    instance('Serial', 'HardwareSerial', 'HardwareSerial Serial (USB serial port, pins 0 RX and 1 TX)'),
    method('HardwareSerial', 'begin', ['unsigned long baud'], 'void', {
      overloads: ['void begin(unsigned long baud, uint8_t config)'],
      example: 'void setup() {\n  Serial.begin(9600);\n}',
    }),
    method('HardwareSerial', 'end', []),
    method('HardwareSerial', 'availableForWrite', [], 'int'),
    method('HardwareSerial', 'flush', []),

    // String
    cls(
      'String',
      [
        'String(const char *value = "")',
        'String(const String &value)',
        'String(const __FlashStringHelper *value)',
        'String(char value)',
        'String(int value, unsigned char base = 10)',
        'String(unsigned int value, unsigned char base = 10)',
        'String(long value, unsigned char base = 10)',
        'String(unsigned long value, unsigned char base = 10)',
        'String(float value, unsigned char decimalPlaces = 2)',
        'String(double value, unsigned char decimalPlaces = 2)',
      ],
      {
        example:
          'String name = "Robo";\nString hex = String(255, HEX); // "ff"\nString t = String(23.456, 1);   // "23.5"',
      },
    ),
    method('String', 'length', [], 'unsigned int'),
    method('String', 'charAt', ['unsigned int index'], 'char'),
    method('String', 'setCharAt', ['unsigned int index', 'char c']),
    method('String', 'concat', ['const String &value'], 'bool', {
      overloads: [
        'bool concat(const char *value)',
        'bool concat(char value)',
        'bool concat(int value)',
        'bool concat(unsigned int value)',
        'bool concat(long value)',
        'bool concat(unsigned long value)',
        'bool concat(float value)',
        'bool concat(double value)',
      ],
    }),
    method('String', 'compareTo', ['const String &other'], 'int'),
    method('String', 'equals', ['const String &other'], 'bool', {
      overloads: ['bool equals(const char *other)'],
    }),
    method('String', 'equalsIgnoreCase', ['const String &other'], 'bool'),
    method('String', 'startsWith', ['const String &prefix'], 'bool', {
      overloads: ['bool startsWith(const String &prefix, unsigned int offset)'],
    }),
    method('String', 'endsWith', ['const String &suffix'], 'bool'),
    method('String', 'indexOf', ['const String &value'], 'int', {
      overloads: [
        'int indexOf(const String &value, unsigned int fromIndex)',
        'int indexOf(char value)',
        'int indexOf(char value, unsigned int fromIndex)',
      ],
      example: 'String cmd = "LED:ON";\nint colon = cmd.indexOf(\':\'); // 3',
    }),
    method('String', 'lastIndexOf', ['const String &value'], 'int', {
      overloads: [
        'int lastIndexOf(const String &value, unsigned int fromIndex)',
        'int lastIndexOf(char value)',
        'int lastIndexOf(char value, unsigned int fromIndex)',
      ],
    }),
    method('String', 'substring', ['unsigned int from', 'unsigned int to'], 'String', {
      overloads: ['String substring(unsigned int from)'],
      example:
        'String cmd = "LED:ON";\nString key = cmd.substring(0, 3); // "LED"\nString val = cmd.substring(4);    // "ON"',
    }),
    method('String', 'replace', ['const String &find', 'const String &replacement'], 'void', {
      overloads: ['void replace(char find, char replacement)'],
    }),
    method('String', 'remove', ['unsigned int index'], 'void', {
      overloads: ['void remove(unsigned int index, unsigned int count)'],
    }),
    method('String', 'toLowerCase', []),
    method('String', 'toUpperCase', []),
    method('String', 'trim', []),
    method('String', 'toInt', [], 'long', { example: 'String s = "42";\nlong n = s.toInt(); // 42' }),
    method('String', 'toFloat', [], 'float'),
    method('String', 'toDouble', [], 'double'),
    method('String', 'c_str', [], 'const char *'),
    method('String', 'reserve', ['unsigned int size'], 'bool'),
    method('String', 'getBytes', ['unsigned char *buf', 'unsigned int bufsize', 'unsigned int index = 0']),
    method('String', 'toCharArray', ['char *buf', 'unsigned int bufsize', 'unsigned int index = 0']),
  ],
};
