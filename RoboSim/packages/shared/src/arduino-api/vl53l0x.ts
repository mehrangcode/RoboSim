import { type ApiTable, cls, constants, method } from './model.js';

const V = 'VL53L0X';

/** Pololu VL53L0X 1.3.1 (`VL53L0X.h`): time-of-flight distance sensor over I2C. */
export const VL53L0X: ApiTable = {
  classes: [{ name: V, library: 'VL53L0X' }],
  entries: [
    cls(V, ['VL53L0X()'], {
      example:
        'VL53L0X tof;\n\nvoid setup() {\n  Wire.begin();\n  tof.setTimeout(500);\n  if (!tof.init()) {\n    Serial.println("VL53L0X not found");\n    while (1) {}\n  }\n  tof.startContinuous();\n}',
    }),
    method(V, 'init', ['bool io_2v8 = true'], 'bool', {
      example: 'if (!tof.init()) Serial.println("init failed");',
    }),
    method(V, 'setTimeout', ['uint16_t timeout'], 'void', { example: 'tof.setTimeout(500); // ms' }),
    method(V, 'getTimeout', [], 'uint16_t'),
    method(V, 'timeoutOccurred', [], 'bool'),
    method(V, 'startContinuous', ['uint32_t period_ms = 0'], 'void', {
      example: 'tof.startContinuous();    // back-to-back\ntof.startContinuous(100); // every 100 ms',
    }),
    method(V, 'stopContinuous', []),
    method(V, 'readRangeContinuousMillimeters', [], 'uint16_t', {
      example:
        'uint16_t mm = tof.readRangeContinuousMillimeters();\nif (tof.timeoutOccurred()) Serial.println("timeout");',
    }),
    method(V, 'readRangeSingleMillimeters', [], 'uint16_t', {
      example: 'uint16_t mm = tof.readRangeSingleMillimeters();',
    }),
    method(V, 'setAddress', ['uint8_t new_addr'], 'void', {
      example: 'tof.setAddress(0x30); // before init() of a second sensor',
    }),
    method(V, 'getAddress', [], 'uint8_t'),
    method(V, 'setBus', ['TwoWire *bus']),
    method(V, 'getBus', [], 'TwoWire *'),
    method(V, 'setSignalRateLimit', ['float limit_Mcps'], 'bool', {
      example: 'tof.setSignalRateLimit(0.1); // long range',
    }),
    method(V, 'getSignalRateLimit', [], 'float'),
    method(V, 'setMeasurementTimingBudget', ['uint32_t budget_us'], 'bool', {
      example: 'tof.setMeasurementTimingBudget(200000); // 200 ms, high accuracy',
    }),
    method(V, 'getMeasurementTimingBudget', [], 'uint32_t'),
    method(V, 'setVcselPulsePeriod', ['vcselPeriodType type', 'uint8_t period_pclks'], 'bool', {
      example:
        'tof.setVcselPulsePeriod(VL53L0X::VcselPeriodPreRange, 18);\ntof.setVcselPulsePeriod(VL53L0X::VcselPeriodFinalRange, 14);',
    }),
    method(V, 'getVcselPulsePeriod', ['vcselPeriodType type'], 'uint8_t'),
    method(V, 'writeReg', ['uint8_t reg', 'uint8_t value']),
    method(V, 'writeReg16Bit', ['uint8_t reg', 'uint16_t value']),
    method(V, 'writeReg32Bit', ['uint8_t reg', 'uint32_t value']),
    method(V, 'readReg', ['uint8_t reg'], 'uint8_t'),
    method(V, 'readReg16Bit', ['uint8_t reg'], 'uint16_t'),
    method(V, 'readReg32Bit', ['uint8_t reg'], 'uint32_t'),
    method(V, 'writeMulti', ['uint8_t reg', 'uint8_t const *src', 'uint8_t count']),
    method(V, 'readMulti', ['uint8_t reg', 'uint8_t *dst', 'uint8_t count']),
    ...constants(
      ['VcselPeriodPreRange', 'VcselPeriodFinalRange'],
      'VL53L0X::vcselPeriodType',
      'VL53L0X.vcselPeriodType',
    ),
  ],
};
