import { type ApiTable, cls, constants, method } from './model.js';

/** Adafruit DHT sensor library 1.4.7 (`DHT.h`). `DHT_Unified` (`DHT_U.h`) is not covered. */
export const DHT: ApiTable = {
  classes: [{ name: 'DHT', library: 'DHT' }],
  entries: [
    cls('DHT', ['DHT(uint8_t pin, uint8_t type, uint8_t count = 6)'], {
      example: 'DHT dht(2, DHT11); // data pin 2\n\nvoid setup() {\n  Serial.begin(9600);\n  dht.begin();\n}',
    }),
    method('DHT', 'begin', ['uint8_t usec = 55'], 'void', { example: 'dht.begin();' }),
    method('DHT', 'readTemperature', ['bool S = false', 'bool force = false'], 'float', {
      example:
        'float c = dht.readTemperature();     // °C\nfloat f = dht.readTemperature(true); // °F\nif (isnan(c)) Serial.println("read failed");',
    }),
    method('DHT', 'readHumidity', ['bool force = false'], 'float', {
      example: 'float h = dht.readHumidity(); // %',
    }),
    method('DHT', 'read', ['bool force = false'], 'bool'),
    method('DHT', 'convertCtoF', ['float c'], 'float'),
    method('DHT', 'convertFtoC', ['float f'], 'float'),
    method(
      'DHT',
      'computeHeatIndex',
      ['float temperature', 'float percentHumidity', 'bool isFahrenheit = true'],
      'float',
      {
        overloads: ['float computeHeatIndex(bool isFahrenheit = true)'],
        example: 'float hi = dht.computeHeatIndex(t, h, false); // t in °C',
      },
    ),
    ...constants(
      ['DHT11', 'DHT12', 'DHT21', 'DHT22', 'AM2301'],
      'static const uint8_t (sensor type)',
      'DHT.sensorType',
    ),
  ],
};
