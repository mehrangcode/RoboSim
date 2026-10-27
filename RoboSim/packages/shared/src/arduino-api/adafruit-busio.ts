import { type ApiTable, cls, constants, method } from './model.js';

const I2C = 'Adafruit_I2CDevice';
const SPI_DEV = 'Adafruit_SPIDevice';
const REG = 'Adafruit_BusIO_Register';
const BITS = 'Adafruit_BusIO_RegisterBits';

/** Adafruit BusIO 1.17.4 (`Adafruit_I2CDevice.h`, `Adafruit_SPIDevice.h`, `Adafruit_BusIO_Register.h`). */
export const ADAFRUIT_BUSIO: ApiTable = {
  classes: [
    { name: I2C, library: 'Adafruit_BusIO' },
    { name: SPI_DEV, library: 'Adafruit_BusIO' },
    { name: REG, library: 'Adafruit_BusIO' },
    { name: BITS, library: 'Adafruit_BusIO' },
  ],
  entries: [
    // Adafruit_I2CDevice
    cls(I2C, ['Adafruit_I2CDevice(uint8_t addr, TwoWire *theWire = &Wire)'], {
      example:
        'Adafruit_I2CDevice dev(0x68);\n\nvoid setup() {\n  if (!dev.begin()) Serial.println("not found");\n}',
    }),
    method(I2C, 'begin', ['bool addr_detect = true'], 'bool'),
    method(I2C, 'end', []),
    method(I2C, 'detected', [], 'bool'),
    method(I2C, 'address', [], 'uint8_t'),
    method(I2C, 'read', ['uint8_t *buffer', 'size_t len', 'bool stop = true'], 'bool'),
    method(
      I2C,
      'write',
      [
        'const uint8_t *buffer',
        'size_t len',
        'bool stop = true',
        'const uint8_t *prefix_buffer = nullptr',
        'size_t prefix_len = 0',
      ],
      'bool',
    ),
    method(
      I2C,
      'write_then_read',
      [
        'const uint8_t *write_buffer',
        'size_t write_len',
        'uint8_t *read_buffer',
        'size_t read_len',
        'bool stop = false',
      ],
      'bool',
      { example: 'uint8_t reg = 0x75, id;\ndev.write_then_read(&reg, 1, &id, 1);' },
    ),
    method(I2C, 'setSpeed', ['uint32_t desiredclk'], 'bool'),
    method(I2C, 'maxBufferSize', [], 'size_t'),

    // Adafruit_SPIDevice
    cls(
      SPI_DEV,
      [
        'Adafruit_SPIDevice(int8_t cspin, uint32_t freq = 1000000, BusIOBitOrder dataOrder = SPI_BITORDER_MSBFIRST, uint8_t dataMode = SPI_MODE0, SPIClass *theSPI = &SPI)',
        'Adafruit_SPIDevice(int8_t cspin, int8_t sck, int8_t miso, int8_t mosi, uint32_t freq = 1000000, BusIOBitOrder dataOrder = SPI_BITORDER_MSBFIRST, uint8_t dataMode = SPI_MODE0)',
      ],
      {
        example:
          'Adafruit_SPIDevice dev(10, 1000000); // CS on pin 10, 1 MHz\n\nvoid setup() {\n  dev.begin();\n}',
      },
    ),
    method(SPI_DEV, 'begin', [], 'bool'),
    method(SPI_DEV, 'read', ['uint8_t *buffer', 'size_t len', 'uint8_t sendvalue = 0xFF'], 'bool'),
    method(
      SPI_DEV,
      'write',
      [
        'const uint8_t *buffer',
        'size_t len',
        'const uint8_t *prefix_buffer = nullptr',
        'size_t prefix_len = 0',
      ],
      'bool',
    ),
    method(
      SPI_DEV,
      'write_then_read',
      [
        'const uint8_t *write_buffer',
        'size_t write_len',
        'uint8_t *read_buffer',
        'size_t read_len',
        'uint8_t sendvalue = 0xFF',
      ],
      'bool',
    ),
    method(SPI_DEV, 'write_and_read', ['uint8_t *buffer', 'size_t len'], 'bool'),
    method(SPI_DEV, 'transfer', ['uint8_t send'], 'uint8_t', {
      overloads: ['void transfer(uint8_t *buffer, size_t len)'],
    }),
    method(SPI_DEV, 'beginTransaction', []),
    method(SPI_DEV, 'endTransaction', []),
    method(SPI_DEV, 'beginTransactionWithAssertingCS', []),
    method(SPI_DEV, 'endTransactionWithDeassertingCS', []),
    ...constants(
      ['SPI_BITORDER_MSBFIRST', 'SPI_BITORDER_LSBFIRST'],
      'BusIOBitOrder',
      'Adafruit_SPIDevice.bitOrder',
    ),

    // Adafruit_BusIO_Register
    cls(
      REG,
      [
        'Adafruit_BusIO_Register(Adafruit_I2CDevice *i2cdevice, uint16_t reg_addr, uint8_t width = 1, uint8_t byteorder = LSBFIRST, uint8_t address_width = 1)',
        'Adafruit_BusIO_Register(Adafruit_SPIDevice *spidevice, uint16_t reg_addr, Adafruit_BusIO_SPIRegType type, uint8_t width = 1, uint8_t byteorder = LSBFIRST, uint8_t address_width = 1)',
        'Adafruit_BusIO_Register(Adafruit_I2CDevice *i2cdevice, Adafruit_SPIDevice *spidevice, Adafruit_BusIO_SPIRegType type, uint16_t reg_addr, uint8_t width = 1, uint8_t byteorder = LSBFIRST, uint8_t address_width = 1)',
      ],
      { example: 'Adafruit_BusIO_Register whoami(&dev, 0x75);\nuint8_t id = whoami.read();' },
    ),
    method(REG, 'read', [], 'uint32_t', {
      overloads: [
        'bool read(uint8_t *buffer, uint8_t len)',
        'bool read(uint8_t *value)',
        'bool read(uint16_t *value)',
      ],
    }),
    method(REG, 'readCached', [], 'uint32_t'),
    method(REG, 'write', ['uint32_t value', 'uint8_t numbytes = 0'], 'bool', {
      overloads: ['bool write(uint8_t *buffer, uint8_t len)'],
    }),
    method(REG, 'width', [], 'uint8_t'),
    method(REG, 'setWidth', ['uint8_t width']),
    method(REG, 'setAddress', ['uint16_t address']),
    method(REG, 'setAddressWidth', ['uint16_t address_width']),
    method(REG, 'print', ['Stream *s = &Serial']),
    method(REG, 'println', ['Stream *s = &Serial']),
    ...constants(
      [
        'ADDRBIT8_HIGH_TOREAD',
        'AD8_HIGH_TOREAD_AD7_HIGH_TOINC',
        'ADDRBIT8_HIGH_TOWRITE',
        'ADDRESSED_OPCODE_BIT0_LOW_TO_WRITE',
      ],
      'Adafruit_BusIO_SPIRegType',
      'Adafruit_BusIO_Register.spiRegType',
    ),

    // Adafruit_BusIO_RegisterBits
    cls(BITS, ['Adafruit_BusIO_RegisterBits(Adafruit_BusIO_Register *reg, uint8_t bits, uint8_t shift)'], {
      example:
        'Adafruit_BusIO_Register cfg(&dev, 0x1C);\nAdafruit_BusIO_RegisterBits range(&cfg, 2, 3); // bits 3–4\nrange.write(1);',
    }),
    method(BITS, 'write', ['uint32_t value'], 'bool'),
    method(BITS, 'read', [], 'uint32_t'),
  ],
};
