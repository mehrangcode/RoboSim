import { type ApiTable, cls, constants, method } from './model.js';

const B = 'Adafruit_BMP280';

/** Adafruit BMP280 3.0.0 (`Adafruit_BMP280.h`). Nested enums are written `Adafruit_BMP280::SAMPLING_X16`. */
export const ADAFRUIT_BMP280: ApiTable = {
  classes: [{ name: B, library: 'Adafruit_BMP280' }],
  entries: [
    cls(
      B,
      [
        'Adafruit_BMP280(TwoWire *theWire = &Wire)',
        'Adafruit_BMP280(int8_t cspin, SPIClass *theSPI = &SPI)',
        'Adafruit_BMP280(int8_t cspin, int8_t mosipin, int8_t misopin, int8_t sckpin)',
      ],
      {
        example:
          'Adafruit_BMP280 bmp; // I2C\n\nvoid setup() {\n  Serial.begin(9600);\n  if (!bmp.begin(0x76)) {\n    Serial.println("BMP280 not found");\n    while (1) delay(10);\n  }\n}',
      },
    ),
    method(B, 'begin', ['uint8_t addr = BMP280_ADDRESS', 'uint8_t chipid = BMP280_CHIPID'], 'bool', {
      example: 'bmp.begin();     // address 0x77\nbmp.begin(0x76); // most breakout boards',
    }),
    method(B, 'readTemperature', [], 'float', { example: 'float t = bmp.readTemperature(); // °C' }),
    method(B, 'readPressure', [], 'float', { example: 'float hPa = bmp.readPressure() / 100.0;' }),
    method(B, 'readAltitude', ['float seaLevelhPa = 1013.25'], 'float', {
      example: 'float m = bmp.readAltitude(1013.25); // metres',
    }),
    method(B, 'seaLevelForAltitude', ['float altitude', 'float atmospheric'], 'float'),
    method(B, 'waterBoilingPoint', ['float pressure'], 'float'),
    method(B, 'takeForcedMeasurement', [], 'bool'),
    method(
      B,
      'setSampling',
      [
        'sensor_mode mode = MODE_NORMAL',
        'sensor_sampling tempSampling = SAMPLING_X16',
        'sensor_sampling pressSampling = SAMPLING_X16',
        'sensor_filter filter = FILTER_OFF',
        'standby_duration duration = STANDBY_MS_1',
      ],
      'void',
      {
        example:
          'bmp.setSampling(Adafruit_BMP280::MODE_NORMAL,\n                Adafruit_BMP280::SAMPLING_X2,\n                Adafruit_BMP280::SAMPLING_X16,\n                Adafruit_BMP280::FILTER_X16,\n                Adafruit_BMP280::STANDBY_MS_500);',
      },
    ),
    method(B, 'getStatus', [], 'uint8_t'),
    method(B, 'sensorID', [], 'uint8_t'),
    method(B, 'reset', []),
    method(B, 'getTemperatureSensor', [], 'Adafruit_Sensor *'),
    method(B, 'getPressureSensor', [], 'Adafruit_Sensor *'),
    ...constants(
      ['BMP280_ADDRESS', 'BMP280_ADDRESS_ALT'],
      'I2C address: 0x77, 0x76',
      'Adafruit_BMP280.address',
    ),
    ...constants(['BMP280_CHIPID'], 'chip ID: 0x58', 'Adafruit_BMP280.BMP280_CHIPID'),
    ...constants(
      ['SAMPLING_NONE', 'SAMPLING_X1', 'SAMPLING_X2', 'SAMPLING_X4', 'SAMPLING_X8', 'SAMPLING_X16'],
      'Adafruit_BMP280::sensor_sampling',
      'Adafruit_BMP280.sampling',
      'Adafruit_BMP280',
    ),
    ...constants(
      ['MODE_SLEEP', 'MODE_FORCED', 'MODE_NORMAL', 'MODE_SOFT_RESET_CODE'],
      'Adafruit_BMP280::sensor_mode',
      'Adafruit_BMP280.mode',
      'Adafruit_BMP280',
    ),
    ...constants(
      ['FILTER_OFF', 'FILTER_X2', 'FILTER_X4', 'FILTER_X8', 'FILTER_X16'],
      'Adafruit_BMP280::sensor_filter',
      'Adafruit_BMP280.filter',
      'Adafruit_BMP280',
    ),
    ...constants(
      [
        'STANDBY_MS_1',
        'STANDBY_MS_63',
        'STANDBY_MS_125',
        'STANDBY_MS_250',
        'STANDBY_MS_500',
        'STANDBY_MS_1000',
        'STANDBY_MS_2000',
        'STANDBY_MS_4000',
      ],
      'Adafruit_BMP280::standby_duration',
      'Adafruit_BMP280.standby',
      'Adafruit_BMP280',
    ),
  ],
};
