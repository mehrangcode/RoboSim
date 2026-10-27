import { type ApiTable, cls, constants, method, type } from './model.js';

const D = 'DallasTemperature';
const ADDR = 'const uint8_t *deviceAddress';

/** DallasTemperature 4.0.6 (`DallasTemperature.h`): DS18B20 and other Maxim 1-Wire thermometers. */
export const DALLAS_TEMPERATURE: ApiTable = {
  classes: [{ name: D, library: 'DallasTemperature' }],
  entries: [
    cls(
      D,
      [
        'DallasTemperature()',
        'DallasTemperature(OneWire *oneWire)',
        'DallasTemperature(OneWire *oneWire, uint8_t pullupPin)',
      ],
      {
        example:
          'OneWire oneWire(2);\nDallasTemperature sensors(&oneWire);\n\nvoid setup() {\n  Serial.begin(9600);\n  sensors.begin();\n}',
      },
    ),
    method(D, 'begin', [], 'void', {
      example: 'sensors.begin();\nSerial.println(sensors.getDeviceCount());',
    }),
    method(D, 'setOneWire', ['OneWire *oneWire']),
    method(D, 'setPullupPin', ['uint8_t pullupPin']),
    method(D, 'getDeviceCount', [], 'uint8_t'),
    method(D, 'getDS18Count', [], 'uint8_t'),
    method(D, 'verifyDeviceCount', [], 'bool'),
    method(D, 'validAddress', [ADDR], 'bool'),
    method(D, 'validFamily', [ADDR], 'bool'),
    method(D, 'getAddress', ['uint8_t *deviceAddress', 'uint8_t index'], 'bool', {
      example: 'DeviceAddress addr;\nif (sensors.getAddress(addr, 0)) sensors.setResolution(addr, 12);',
    }),
    method(D, 'isConnected', [ADDR], 'bool', {
      overloads: ['bool isConnected(const uint8_t *deviceAddress, uint8_t *scratchPad)'],
    }),
    method(D, 'readScratchPad', [ADDR, 'uint8_t *scratchPad'], 'bool'),
    method(D, 'writeScratchPad', [ADDR, 'const uint8_t *scratchPad']),
    method(D, 'readPowerSupply', ['const uint8_t *deviceAddress = nullptr'], 'bool'),
    method(D, 'isParasitePowerMode', [], 'bool'),
    method(D, 'getResolution', [], 'uint8_t', {
      overloads: ['uint8_t getResolution(const uint8_t *deviceAddress)'],
    }),
    method(D, 'setResolution', ['uint8_t newResolution'], 'void', {
      overloads: [
        'bool setResolution(const uint8_t *deviceAddress, uint8_t newResolution, bool skipGlobalBitResolutionCalculation = false)',
      ],
      example: 'sensors.setResolution(10); // 0.25 °C steps, ~188 ms',
    }),
    method(D, 'setWaitForConversion', ['bool flag'], 'void', {
      example: 'sensors.setWaitForConversion(false);\nsensors.requestTemperatures(); // returns at once',
    }),
    method(D, 'getWaitForConversion', [], 'bool'),
    method(D, 'setCheckForConversion', ['bool flag']),
    method(D, 'getCheckForConversion', [], 'bool'),
    method(D, 'isConversionComplete', [], 'bool'),
    method(D, 'millisToWaitForConversion', [], 'uint16_t', {
      overloads: ['static uint16_t millisToWaitForConversion(uint8_t bitResolution)'],
    }),
    method(D, 'blockTillConversionComplete', ['uint8_t bitResolution'], 'void', {
      overloads: [
        'void blockTillConversionComplete(uint8_t bitResolution, unsigned long start)',
        'void blockTillConversionComplete(uint8_t bitResolution, request_t req)',
      ],
    }),
    method(D, 'requestTemperatures', [], 'request_t', {
      example: 'sensors.requestTemperatures();\nfloat c = sensors.getTempCByIndex(0);',
    }),
    method(D, 'requestTemperaturesByAddress', [ADDR], 'request_t'),
    method(D, 'requestTemperaturesByIndex', ['uint8_t index'], 'request_t'),
    method(D, 'getTempCByIndex', ['uint8_t index'], 'float', {
      example:
        'float c = sensors.getTempCByIndex(0);\nif (c == DEVICE_DISCONNECTED_C) Serial.println("no sensor");',
    }),
    method(D, 'getTempFByIndex', ['uint8_t index'], 'float'),
    method(D, 'getTempC', [ADDR, 'byte retryCount = 0'], 'float', {
      example: 'float c = sensors.getTempC(addr);',
    }),
    method(D, 'getTempF', [ADDR], 'float'),
    method(D, 'getTemp', [ADDR, 'byte retryCount = 0'], 'int32_t'),
    method(D, 'saveScratchPad', ['const uint8_t *deviceAddress = nullptr'], 'bool'),
    method(D, 'saveScratchPadByIndex', ['uint8_t index'], 'bool'),
    method(D, 'recallScratchPad', ['const uint8_t *deviceAddress = nullptr'], 'bool'),
    method(D, 'recallScratchPadByIndex', ['uint8_t index'], 'bool'),
    method(D, 'setAutoSaveScratchPad', ['bool flag']),
    method(D, 'getAutoSaveScratchPad', [], 'bool'),
    method(D, 'setHighAlarmTemp', [ADDR, 'int8_t celsius']),
    method(D, 'setLowAlarmTemp', [ADDR, 'int8_t celsius']),
    method(D, 'getHighAlarmTemp', [ADDR], 'int8_t'),
    method(D, 'getLowAlarmTemp', [ADDR], 'int8_t'),
    method(D, 'resetAlarmSearch', []),
    method(D, 'alarmSearch', ['uint8_t *newAddr'], 'bool'),
    method(D, 'hasAlarm', [], 'bool', { overloads: ['bool hasAlarm(const uint8_t *deviceAddress)'] }),
    method(D, 'processAlarms', []),
    method(D, 'setAlarmHandler', ['const AlarmHandler *handler']),
    method(D, 'hasAlarmHandler', [], 'bool'),
    method(D, 'setUserData', [ADDR, 'int16_t data']),
    method(D, 'setUserDataByIndex', ['uint8_t index', 'int16_t data']),
    method(D, 'getUserData', [ADDR], 'int16_t'),
    method(D, 'getUserDataByIndex', ['uint8_t index'], 'int16_t'),
    method(D, 'toFahrenheit', ['float celsius'], 'static float'),
    method(D, 'toCelsius', ['float fahrenheit'], 'static float'),
    method(D, 'rawToCelsius', ['int32_t raw'], 'static float'),
    method(D, 'rawToFahrenheit', ['int32_t raw'], 'static float'),
    method(D, 'celsiusToRaw', ['float celsius'], 'static int16_t'),
    type('DeviceAddress', 'typedef uint8_t DeviceAddress[8]', {
      doc: 'DallasTemperature.DeviceAddress',
      example: 'DeviceAddress addr;\nsensors.getAddress(addr, 0);',
    }),
    ...constants(
      ['DEVICE_DISCONNECTED_C', 'DEVICE_DISCONNECTED_F', 'DEVICE_DISCONNECTED_RAW'],
      '-127 °C, -196.6 °F, -7040 raw',
      'DallasTemperature.disconnected',
    ),
    ...constants(
      [
        'DEVICE_FAULT_OPEN_C',
        'DEVICE_FAULT_SHORTGND_C',
        'DEVICE_FAULT_SHORTVDD_C',
        'DEVICE_POWER_ON_RESET_C',
        'DEVICE_INSUFFICIENT_POWER_C',
      ],
      'error readings (°C): -254, -253, -252, -251, -250',
      'DallasTemperature.faultC',
    ),
    ...constants(
      ['DS18S20MODEL', 'DS18B20MODEL', 'DS1822MODEL', 'DS1825MODEL', 'DS28EA00MODEL'],
      'family code: 0x10, 0x28, 0x22, 0x3B, 0x42',
      'DallasTemperature.model',
    ),
  ],
};
