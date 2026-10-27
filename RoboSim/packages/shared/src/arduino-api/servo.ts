import { type ApiTable, cls, constants, method } from './model.js';

/** Servo 1.3.0 (`Servo.h`). */
export const SERVO: ApiTable = {
  classes: [{ name: 'Servo', library: 'Servo' }],
  entries: [
    cls('Servo', ['Servo()'], { example: 'Servo arm;\n\nvoid setup() {\n  arm.attach(9);\n}' }),
    method('Servo', 'attach', ['int pin'], 'uint8_t', {
      overloads: ['uint8_t attach(int pin, int min, int max)'],
      example: 'arm.attach(9);            // 544–2400 µs\narm.attach(9, 1000, 2000); // custom range',
    }),
    method('Servo', 'detach', []),
    method('Servo', 'write', ['int value'], 'void', { example: 'arm.write(90); // centre' }),
    method('Servo', 'writeMicroseconds', ['int value'], 'void', { example: 'arm.writeMicroseconds(1500);' }),
    method('Servo', 'read', [], 'int'),
    method('Servo', 'readMicroseconds', [], 'int'),
    method('Servo', 'attached', [], 'bool'),
    ...constants(
      ['MIN_PULSE_WIDTH', 'MAX_PULSE_WIDTH', 'DEFAULT_PULSE_WIDTH'],
      'pulse width (µs)',
      'Servo.pulseWidth',
    ),
    ...constants(['MAX_SERVOS'], 'servos per board (12 on the Uno)', 'Servo.MAX_SERVOS'),
  ],
};
