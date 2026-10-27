import { type ApiTable, cls, constants, method } from './model.js';

const D = 'Adafruit_SSD1306';

/** Adafruit SSD1306 2.5.17 (`Adafruit_SSD1306.h`): monochrome OLED driver; drawing comes from `Adafruit_GFX`. */
export const ADAFRUIT_SSD1306: ApiTable = {
  classes: [{ name: D, library: 'Adafruit_SSD1306', extends: ['Adafruit_GFX'] }],
  entries: [
    cls(
      D,
      [
        'Adafruit_SSD1306(uint8_t w, uint8_t h, TwoWire *wire = &Wire, int8_t rstPin = -1, uint32_t clkDuring = 400000UL, uint32_t clkAfter = 100000UL)',
        'Adafruit_SSD1306(uint8_t w, uint8_t h, int8_t mosiPin, int8_t sclkPin, int8_t dcPin, int8_t rstPin, int8_t csPin)',
        'Adafruit_SSD1306(uint8_t w, uint8_t h, SPIClass *spi, int8_t dcPin, int8_t rstPin, int8_t csPin, uint32_t bitrate = 8000000UL)',
      ],
      {
        example:
          '#define SCREEN_WIDTH 128\n#define SCREEN_HEIGHT 64\n\nAdafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);',
      },
    ),
    method(
      D,
      'begin',
      [
        'uint8_t vcc = SSD1306_SWITCHCAPVCC',
        'uint8_t address = 0',
        'bool reset = true',
        'bool periphBegin = true',
      ],
      'bool',
      {
        insert: 'begin(SSD1306_SWITCHCAPVCC, ${1:0x3C})',
        example:
          'void setup() {\n  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {\n    for (;;); // display not found\n  }\n  display.clearDisplay();\n}',
      },
    ),
    method(D, 'display', [], 'void', {
      example:
        'display.clearDisplay();\ndisplay.setCursor(0, 0);\ndisplay.print("Hello");\ndisplay.display(); // show it',
    }),
    method(D, 'clearDisplay', []),
    method(D, 'dim', ['bool dim']),
    method(D, 'startscrollright', ['uint8_t start', 'uint8_t stop'], 'void', {
      example: 'display.startscrollright(0x00, 0x07); // whole 128x64 screen',
    }),
    method(D, 'startscrollleft', ['uint8_t start', 'uint8_t stop']),
    method(D, 'startscrolldiagright', ['uint8_t start', 'uint8_t stop']),
    method(D, 'startscrolldiagleft', ['uint8_t start', 'uint8_t stop']),
    method(D, 'stopscroll', []),
    method(D, 'ssd1306_command', ['uint8_t command']),
    method(D, 'getPixel', ['int16_t x', 'int16_t y'], 'bool'),
    method(D, 'getBuffer', [], 'uint8_t *'),
    ...constants(
      ['SSD1306_SWITCHCAPVCC', 'SSD1306_EXTERNALVCC'],
      'display power source (begin)',
      'Adafruit_SSD1306.vcc',
    ),
    ...constants(
      ['SSD1306_WHITE', 'SSD1306_BLACK', 'SSD1306_INVERSE'],
      'pixel colour (1, 0, 2)',
      'Adafruit_SSD1306.color',
    ),
    ...constants(
      ['WHITE', 'BLACK', 'INVERSE'],
      'pixel colour (legacy names)',
      'Adafruit_SSD1306.legacyColor',
    ),
    ...constants(
      [
        'SSD1306_DISPLAYON',
        'SSD1306_DISPLAYOFF',
        'SSD1306_SETCONTRAST',
        'SSD1306_NORMALDISPLAY',
        'SSD1306_INVERTDISPLAY',
      ],
      'controller command (ssd1306_command)',
      'Adafruit_SSD1306.command',
    ),
  ],
};
