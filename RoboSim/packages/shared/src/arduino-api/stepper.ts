import { type ApiTable, cls, method } from './model.js';

/** Stepper 1.1.3 (`Stepper.h`). */
export const STEPPER: ApiTable = {
  classes: [{ name: 'Stepper', library: 'Stepper' }],
  entries: [
    cls(
      'Stepper',
      [
        'Stepper(int stepsPerRevolution, int pin1, int pin2)',
        'Stepper(int stepsPerRevolution, int pin1, int pin2, int pin3, int pin4)',
        'Stepper(int stepsPerRevolution, int pin1, int pin2, int pin3, int pin4, int pin5)',
      ],
      {
        example:
          'Stepper motor(2048, 8, 10, 9, 11); // 28BYJ-48 via ULN2003\n\nvoid setup() {\n  motor.setSpeed(10);\n}',
      },
    ),
    method('Stepper', 'setSpeed', ['long rpm'], 'void', { example: 'motor.setSpeed(10); // 10 RPM' }),
    method('Stepper', 'step', ['int steps'], 'void', {
      example: 'motor.step(2048);  // one turn forward\nmotor.step(-1024); // half a turn back',
    }),
    method('Stepper', 'version', [], 'int'),
  ],
};
