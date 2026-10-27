import { type ApiTable, constants, method, type } from './model.js';

/** Adafruit Unified Sensor 1.1.15 (`Adafruit_Sensor.h`): the common base of Adafruit sensor drivers. */
export const ADAFRUIT_SENSOR: ApiTable = {
  classes: [{ name: 'Adafruit_Sensor', library: 'Adafruit_Sensor' }],
  entries: [
    type('Adafruit_Sensor', 'class Adafruit_Sensor', {
      doc: 'Adafruit_Sensor.Adafruit_Sensor',
      example: 'Adafruit_Sensor *temp = mpu.getTemperatureSensor();\nsensors_event_t e;\ntemp->getEvent(&e);',
    }),
    method('Adafruit_Sensor', 'getEvent', ['sensors_event_t *event'], 'bool', {
      example: 'sensors_event_t e;\nsensor->getEvent(&e);\nSerial.println(e.temperature);',
    }),
    method('Adafruit_Sensor', 'getSensor', ['sensor_t *sensor']),
    method('Adafruit_Sensor', 'enableAutoRange', ['bool enabled']),
    method('Adafruit_Sensor', 'printSensorDetails', []),
    type(
      'sensors_event_t',
      'struct sensors_event_t { int32_t sensor_id, type, timestamp; union { sensors_vec_t acceleration, gyro, magnetic, orientation; float temperature, pressure, relative_humidity, distance, light, altitude, …; }; }',
      {
        doc: 'Adafruit_Sensor.sensors_event_t',
        example:
          'sensors_event_t a, g, temp;\nmpu.getEvent(&a, &g, &temp);\nSerial.println(a.acceleration.x); // m/s²\nSerial.println(temp.temperature); // °C',
      },
    ),
    type(
      'sensors_vec_t',
      'struct sensors_vec_t { float x, y, z; /* or roll, pitch, heading */ float v[3]; int8_t status; }',
      {
        doc: 'Adafruit_Sensor.sensors_vec_t',
      },
    ),
    type(
      'sensor_t',
      'struct sensor_t { char name[12]; int32_t version, sensor_id, type; float max_value, min_value, resolution; int32_t min_delay; }',
      {
        doc: 'Adafruit_Sensor.sensor_t',
        example: 'sensor_t s;\nsensor->getSensor(&s);\nSerial.println(s.name);',
      },
    ),
    ...constants(
      ['SENSORS_GRAVITY_EARTH', 'SENSORS_GRAVITY_MOON', 'SENSORS_GRAVITY_SUN', 'SENSORS_GRAVITY_STANDARD'],
      'gravity (m/s²): 9.80665, 1.6, 275.0, 9.80665',
      'Adafruit_Sensor.gravity',
    ),
    ...constants(
      ['SENSORS_MAGFIELD_EARTH_MAX', 'SENSORS_MAGFIELD_EARTH_MIN'],
      "Earth's magnetic field (µT): 60, 30",
      'Adafruit_Sensor.magfield',
    ),
    ...constants(
      ['SENSORS_PRESSURE_SEALEVELHPA'],
      'average sea-level pressure: 1013.25 hPa',
      'Adafruit_Sensor.SENSORS_PRESSURE_SEALEVELHPA',
    ),
    ...constants(
      ['SENSORS_DPS_TO_RADS', 'SENSORS_RADS_TO_DPS', 'SENSORS_GAUSS_TO_MICROTESLA'],
      'unit multipliers: 0.017453293, 57.29577793, 100',
      'Adafruit_Sensor.conversion',
    ),
    ...constants(
      [
        'SENSOR_TYPE_ACCELEROMETER',
        'SENSOR_TYPE_MAGNETIC_FIELD',
        'SENSOR_TYPE_ORIENTATION',
        'SENSOR_TYPE_GYROSCOPE',
        'SENSOR_TYPE_LIGHT',
        'SENSOR_TYPE_PRESSURE',
        'SENSOR_TYPE_PROXIMITY',
        'SENSOR_TYPE_GRAVITY',
        'SENSOR_TYPE_LINEAR_ACCELERATION',
        'SENSOR_TYPE_ROTATION_VECTOR',
        'SENSOR_TYPE_RELATIVE_HUMIDITY',
        'SENSOR_TYPE_AMBIENT_TEMPERATURE',
        'SENSOR_TYPE_OBJECT_TEMPERATURE',
        'SENSOR_TYPE_VOLTAGE',
        'SENSOR_TYPE_CURRENT',
        'SENSOR_TYPE_COLOR',
        'SENSOR_TYPE_TVOC',
        'SENSOR_TYPE_VOC_INDEX',
        'SENSOR_TYPE_NOX_INDEX',
        'SENSOR_TYPE_CO2',
        'SENSOR_TYPE_ECO2',
        'SENSOR_TYPE_PM10_STD',
        'SENSOR_TYPE_PM25_STD',
        'SENSOR_TYPE_PM100_STD',
        'SENSOR_TYPE_PM10_ENV',
        'SENSOR_TYPE_PM25_ENV',
        'SENSOR_TYPE_PM100_ENV',
        'SENSOR_TYPE_GAS_RESISTANCE',
        'SENSOR_TYPE_UNITLESS_PERCENT',
        'SENSOR_TYPE_ALTITUDE',
      ],
      'sensors_type_t (sensor_t.type / sensors_event_t.type)',
      'Adafruit_Sensor.sensorType',
    ),
  ],
};
