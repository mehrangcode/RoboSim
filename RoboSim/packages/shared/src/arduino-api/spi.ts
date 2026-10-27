import { type ApiTable, cls, constants, instance, method, type } from './model.js';

/** SPI 1.0 (AVR core, `SPI.h`). LSBFIRST/MSBFIRST are core constants. */
export const SPI: ApiTable = {
  classes: [
    { name: 'SPISettings', library: 'SPI' },
    { name: 'SPIClass', library: 'SPI', instances: ['SPI'] },
  ],
  entries: [
    cls('SPISettings', ['SPISettings(uint32_t clock, uint8_t bitOrder, uint8_t dataMode)', 'SPISettings()'], {
      example: 'SPISettings settings(1000000, MSBFIRST, SPI_MODE0); // 1 MHz',
    }),
    type('SPIClass', 'class SPIClass', { doc: 'SPIClass.SPIClass' }),
    instance('SPI', 'SPIClass', 'SPIClass SPI'),
    method('SPIClass', 'begin', [], 'void', {
      example: 'SPI.begin(); // pins 11 (MOSI), 12 (MISO), 13 (SCK)',
    }),
    method('SPIClass', 'end', []),
    method('SPIClass', 'beginTransaction', ['SPISettings settings'], 'void', {
      example:
        'SPI.beginTransaction(SPISettings(1000000, MSBFIRST, SPI_MODE0));\ndigitalWrite(10, LOW);\nbyte reply = SPI.transfer(0x42);\ndigitalWrite(10, HIGH);\nSPI.endTransaction();',
    }),
    method('SPIClass', 'endTransaction', []),
    method('SPIClass', 'transfer', ['uint8_t data'], 'uint8_t', {
      overloads: ['void transfer(void *buf, size_t count)'],
      example:
        'byte reply = SPI.transfer(0x42);\n\nbyte buf[4] = {1, 2, 3, 4};\nSPI.transfer(buf, 4); // buf now holds the replies',
    }),
    method('SPIClass', 'transfer16', ['uint16_t data'], 'uint16_t'),
    method('SPIClass', 'usingInterrupt', ['uint8_t interruptNumber']),
    method('SPIClass', 'notUsingInterrupt', ['uint8_t interruptNumber']),
    method('SPIClass', 'setBitOrder', ['uint8_t bitOrder']),
    method('SPIClass', 'setDataMode', ['uint8_t dataMode']),
    method('SPIClass', 'setClockDivider', ['uint8_t clockDiv']),
    method('SPIClass', 'attachInterrupt', []),
    method('SPIClass', 'detachInterrupt', []),
    ...constants(['SPI_MODE0', 'SPI_MODE1', 'SPI_MODE2', 'SPI_MODE3'], 'SPI data mode', 'SPIClass.dataMode'),
    ...constants(
      [
        'SPI_CLOCK_DIV2',
        'SPI_CLOCK_DIV4',
        'SPI_CLOCK_DIV8',
        'SPI_CLOCK_DIV16',
        'SPI_CLOCK_DIV32',
        'SPI_CLOCK_DIV64',
        'SPI_CLOCK_DIV128',
      ],
      'SPI clock divider',
      'SPIClass.clockDivider',
    ),
  ],
};
