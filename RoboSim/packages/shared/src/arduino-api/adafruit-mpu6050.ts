import { type ApiTable, cls, constants, method } from './model.js';

const M = 'Adafruit_MPU6050';

/** Adafruit MPU6050 2.2.9 (`Adafruit_MPU6050.h`). */
export const ADAFRUIT_MPU6050: ApiTable = {
  classes: [{ name: M, library: 'Adafruit_MPU6050' }],
  entries: [
    cls(M, ['Adafruit_MPU6050()'], {
      example:
        'Adafruit_MPU6050 mpu;\n\nvoid setup() {\n  Serial.begin(9600);\n  if (!mpu.begin()) {\n    Serial.println("MPU6050 not found");\n    while (1) delay(10);\n  }\n}',
    }),
    method(
      M,
      'begin',
      ['uint8_t i2c_addr = MPU6050_I2CADDR_DEFAULT', 'TwoWire *wire = &Wire', 'int32_t sensorID = 0'],
      'bool',
      {
        example: 'mpu.begin();     // address 0x68\nmpu.begin(0x69); // AD0 pin high',
      },
    ),
    method(
      M,
      'getEvent',
      ['sensors_event_t *accel', 'sensors_event_t *gyro', 'sensors_event_t *temp'],
      'bool',
      {
        example:
          'sensors_event_t a, g, temp;\nmpu.getEvent(&a, &g, &temp);\nSerial.println(a.acceleration.x); // m/s²\nSerial.println(g.gyro.z);         // rad/s\nSerial.println(temp.temperature); // °C',
      },
    ),
    method(M, 'setAccelerometerRange', ['mpu6050_accel_range_t range'], 'void', {
      example: 'mpu.setAccelerometerRange(MPU6050_RANGE_8_G);',
    }),
    method(M, 'getAccelerometerRange', [], 'mpu6050_accel_range_t'),
    method(M, 'setGyroRange', ['mpu6050_gyro_range_t range'], 'void', {
      example: 'mpu.setGyroRange(MPU6050_RANGE_500_DEG);',
    }),
    method(M, 'getGyroRange', [], 'mpu6050_gyro_range_t'),
    method(M, 'setFilterBandwidth', ['mpu6050_bandwidth_t bandwidth'], 'void', {
      example: 'mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);',
    }),
    method(M, 'getFilterBandwidth', [], 'mpu6050_bandwidth_t'),
    method(M, 'setHighPassFilter', ['mpu6050_highpass_t bandwidth']),
    method(M, 'getHighPassFilter', [], 'mpu6050_highpass_t'),
    method(M, 'setMotionInterrupt', ['bool active'], 'void', {
      example:
        'mpu.setHighPassFilter(MPU6050_HIGHPASS_0_63_HZ);\nmpu.setMotionDetectionThreshold(1);\nmpu.setMotionDetectionDuration(20);\nmpu.setMotionInterrupt(true);',
    }),
    method(M, 'setMotionDetectionThreshold', ['uint8_t thr']),
    method(M, 'setMotionDetectionDuration', ['uint8_t dur']),
    method(M, 'getMotionInterruptStatus', [], 'bool', {
      example: 'if (mpu.getMotionInterruptStatus()) Serial.println("moved!");',
    }),
    method(M, 'setInterruptPinPolarity', ['bool active_low']),
    method(M, 'setInterruptPinLatch', ['bool held']),
    method(M, 'setFsyncSampleOutput', ['mpu6050_fsync_out_t fsync_output']),
    method(M, 'getFsyncSampleOutput', [], 'mpu6050_fsync_out_t'),
    method(M, 'setI2CBypass', ['bool bypass']),
    method(M, 'setClock', ['mpu6050_clock_select_t clock']),
    method(M, 'getClock', [], 'mpu6050_clock_select_t'),
    method(M, 'setSampleRateDivisor', ['uint8_t divisor']),
    method(M, 'getSampleRateDivisor', [], 'uint8_t'),
    method(M, 'enableSleep', ['bool enable'], 'bool'),
    method(M, 'enableCycle', ['bool enable'], 'bool'),
    method(M, 'setCycleRate', ['mpu6050_cycle_rate_t rate']),
    method(M, 'getCycleRate', [], 'mpu6050_cycle_rate_t'),
    method(M, 'setGyroStandby', ['bool xAxisStandby', 'bool yAxisStandby', 'bool zAxisStandby'], 'bool'),
    method(
      M,
      'setAccelerometerStandby',
      ['bool xAxisStandby', 'bool yAxisStandby', 'bool zAxisStandby'],
      'bool',
    ),
    method(M, 'setTemperatureStandby', ['bool enable'], 'bool'),
    method(M, 'reset', []),
    method(M, 'getTemperatureSensor', [], 'Adafruit_Sensor *'),
    method(M, 'getAccelerometerSensor', [], 'Adafruit_Sensor *'),
    method(M, 'getGyroSensor', [], 'Adafruit_Sensor *'),
    ...constants(
      ['MPU6050_I2CADDR_DEFAULT'],
      'default I2C address: 0x68',
      'Adafruit_MPU6050.MPU6050_I2CADDR_DEFAULT',
    ),
    ...constants(
      ['MPU6050_RANGE_2_G', 'MPU6050_RANGE_4_G', 'MPU6050_RANGE_8_G', 'MPU6050_RANGE_16_G'],
      'mpu6050_accel_range_t',
      'Adafruit_MPU6050.accelRange',
    ),
    ...constants(
      ['MPU6050_RANGE_250_DEG', 'MPU6050_RANGE_500_DEG', 'MPU6050_RANGE_1000_DEG', 'MPU6050_RANGE_2000_DEG'],
      'mpu6050_gyro_range_t',
      'Adafruit_MPU6050.gyroRange',
    ),
    ...constants(
      [
        'MPU6050_BAND_260_HZ',
        'MPU6050_BAND_184_HZ',
        'MPU6050_BAND_94_HZ',
        'MPU6050_BAND_44_HZ',
        'MPU6050_BAND_21_HZ',
        'MPU6050_BAND_10_HZ',
        'MPU6050_BAND_5_HZ',
      ],
      'mpu6050_bandwidth_t',
      'Adafruit_MPU6050.bandwidth',
    ),
    ...constants(
      [
        'MPU6050_HIGHPASS_DISABLE',
        'MPU6050_HIGHPASS_5_HZ',
        'MPU6050_HIGHPASS_2_5_HZ',
        'MPU6050_HIGHPASS_1_25_HZ',
        'MPU6050_HIGHPASS_0_63_HZ',
        'MPU6050_HIGHPASS_UNUSED',
        'MPU6050_HIGHPASS_HOLD',
      ],
      'mpu6050_highpass_t',
      'Adafruit_MPU6050.highpass',
    ),
    ...constants(
      ['MPU6050_CYCLE_1_25_HZ', 'MPU6050_CYCLE_5_HZ', 'MPU6050_CYCLE_20_HZ', 'MPU6050_CYCLE_40_HZ'],
      'mpu6050_cycle_rate_t',
      'Adafruit_MPU6050.cycleRate',
    ),
    ...constants(
      [
        'MPU6050_FSYNC_OUT_DISABLED',
        'MPU6050_FSYNC_OUT_TEMP',
        'MPU6050_FSYNC_OUT_GYROX',
        'MPU6050_FSYNC_OUT_GYROY',
        'MPU6050_FSYNC_OUT_GYROZ',
        'MPU6050_FSYNC_OUT_ACCELX',
        'MPU6050_FSYNC_OUT_ACCELY',
        'MPU6050_FSYNC_OUT_ACCEL_Z',
      ],
      'mpu6050_fsync_out_t',
      'Adafruit_MPU6050.fsyncOut',
    ),
    ...constants(
      [
        'MPU6050_INTR_8MHz',
        'MPU6050_PLL_GYROX',
        'MPU6050_PLL_GYROY',
        'MPU6050_PLL_GYROZ',
        'MPU6050_PLL_EXT_32K',
        'MPU6050_PLL_EXT_19MHz',
        'MPU6050_STOP',
      ],
      'mpu6050_clock_select_t',
      'Adafruit_MPU6050.clockSelect',
    ),
  ],
};
