import { type ApiTable, cls, constants, method } from './model.js';

/** NewPing 1.9.7 (`NewPing.h`): HC-SR04-style ultrasonic sensors. Timer methods need Timer2 (AVR). */
export const NEW_PING: ApiTable = {
  classes: [{ name: 'NewPing', library: 'NewPing' }],
  entries: [
    cls(
      'NewPing',
      ['NewPing(uint8_t trigger_pin, uint8_t echo_pin, unsigned int max_cm_distance = MAX_SENSOR_DISTANCE)'],
      {
        example: 'NewPing sonar(12, 11, 200); // trigger, echo, max 200 cm',
      },
    ),
    method('NewPing', 'ping', ['unsigned int max_cm_distance = 0'], 'unsigned int', {
      example: 'unsigned int us = sonar.ping();\nunsigned int cm = NewPing::convert_cm(us);',
    }),
    method('NewPing', 'ping_cm', ['unsigned int max_cm_distance = 0'], 'unsigned long', {
      example: 'unsigned long cm = sonar.ping_cm();\nif (cm == 0) {\n  // nothing in range\n}',
    }),
    method('NewPing', 'ping_in', ['unsigned int max_cm_distance = 0'], 'unsigned long'),
    method(
      'NewPing',
      'ping_median',
      ['uint8_t it = 5', 'unsigned int max_cm_distance = 0'],
      'unsigned long',
      {
        example: 'unsigned int cm = NewPing::convert_cm(sonar.ping_median(5));',
      },
    ),
    method('NewPing', 'convert_cm', ['unsigned int echoTime'], 'unsigned int'),
    method('NewPing', 'convert_in', ['unsigned int echoTime'], 'unsigned int'),
    method('NewPing', 'ping_timer', ['void (*userFunc)()', 'unsigned int max_cm_distance = 0'], 'void', {
      example:
        'void echoCheck() {\n  if (sonar.check_timer()) {\n    Serial.println(sonar.ping_result / US_ROUNDTRIP_CM);\n  }\n}\n\nvoid loop() {\n  sonar.ping_timer(echoCheck);\n  delay(50);\n}',
    }),
    method('NewPing', 'check_timer', [], 'boolean'),
    method('NewPing', 'timer_us', ['unsigned int frequency', 'void (*userFunc)()']),
    method('NewPing', 'timer_ms', ['unsigned long frequency', 'void (*userFunc)()']),
    method('NewPing', 'timer_stop', []),
    ...constants(['MAX_SENSOR_DISTANCE'], 'default maximum distance (500 cm)', 'NewPing.MAX_SENSOR_DISTANCE'),
    ...constants(['NO_ECHO'], 'no echo received (0)', 'NewPing.NO_ECHO'),
    ...constants(
      ['US_ROUNDTRIP_CM', 'US_ROUNDTRIP_IN'],
      'echo time per distance unit (µs)',
      'NewPing.roundTrip',
    ),
  ],
};
