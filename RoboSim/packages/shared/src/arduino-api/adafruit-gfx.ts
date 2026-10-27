import { type ApiTable, cls, method } from './model.js';

const G = 'Adafruit_GFX';

/** Adafruit GFX 1.12.6 (`Adafruit_GFX.h`): drawing and text API shared by displays such as the SSD1306. */
export const ADAFRUIT_GFX: ApiTable = {
  classes: [{ name: G, library: 'Adafruit_GFX', extends: ['Print'] }],
  entries: [
    cls(G, ['Adafruit_GFX(int16_t w, int16_t h)']),
    // Pixels, lines and shapes
    method(G, 'drawPixel', ['int16_t x', 'int16_t y', 'uint16_t color'], 'void', {
      example: 'display.drawPixel(10, 20, SSD1306_WHITE);',
    }),
    method(
      G,
      'drawLine',
      ['int16_t x0', 'int16_t y0', 'int16_t x1', 'int16_t y1', 'uint16_t color'],
      'void',
      {
        example: 'display.drawLine(0, 0, 127, 63, SSD1306_WHITE);',
      },
    ),
    method(G, 'drawFastHLine', ['int16_t x', 'int16_t y', 'int16_t w', 'uint16_t color']),
    method(G, 'drawFastVLine', ['int16_t x', 'int16_t y', 'int16_t h', 'uint16_t color']),
    method(G, 'drawRect', ['int16_t x', 'int16_t y', 'int16_t w', 'int16_t h', 'uint16_t color'], 'void', {
      example: 'display.drawRect(10, 10, 50, 30, SSD1306_WHITE);',
    }),
    method(G, 'fillRect', ['int16_t x', 'int16_t y', 'int16_t w', 'int16_t h', 'uint16_t color'], 'void', {
      example: 'display.fillRect(10, 10, 50, 30, SSD1306_WHITE);',
    }),
    method(G, 'fillScreen', ['uint16_t color'], 'void', { example: 'display.fillScreen(SSD1306_BLACK);' }),
    method(G, 'drawCircle', ['int16_t x0', 'int16_t y0', 'int16_t r', 'uint16_t color'], 'void', {
      example: 'display.drawCircle(64, 32, 20, SSD1306_WHITE);',
    }),
    method(G, 'fillCircle', ['int16_t x0', 'int16_t y0', 'int16_t r', 'uint16_t color'], 'void', {
      example: 'display.fillCircle(64, 32, 10, SSD1306_WHITE);',
    }),
    method(G, 'drawCircleHelper', [
      'int16_t x0',
      'int16_t y0',
      'int16_t r',
      'uint8_t cornername',
      'uint16_t color',
    ]),
    method(G, 'fillCircleHelper', [
      'int16_t x0',
      'int16_t y0',
      'int16_t r',
      'uint8_t cornername',
      'int16_t delta',
      'uint16_t color',
    ]),
    method(G, 'drawEllipse', ['int16_t x0', 'int16_t y0', 'int16_t rw', 'int16_t rh', 'uint16_t color']),
    method(G, 'fillEllipse', ['int16_t x0', 'int16_t y0', 'int16_t rw', 'int16_t rh', 'uint16_t color']),
    method(
      G,
      'drawTriangle',
      ['int16_t x0', 'int16_t y0', 'int16_t x1', 'int16_t y1', 'int16_t x2', 'int16_t y2', 'uint16_t color'],
      'void',
      { example: 'display.drawTriangle(64, 5, 40, 50, 88, 50, SSD1306_WHITE);' },
    ),
    method(G, 'fillTriangle', [
      'int16_t x0',
      'int16_t y0',
      'int16_t x1',
      'int16_t y1',
      'int16_t x2',
      'int16_t y2',
      'uint16_t color',
    ]),
    method(
      G,
      'drawRoundRect',
      ['int16_t x0', 'int16_t y0', 'int16_t w', 'int16_t h', 'int16_t radius', 'uint16_t color'],
      'void',
      {
        example: 'display.drawRoundRect(10, 10, 60, 30, 5, SSD1306_WHITE);',
      },
    ),
    method(G, 'fillRoundRect', [
      'int16_t x0',
      'int16_t y0',
      'int16_t w',
      'int16_t h',
      'int16_t radius',
      'uint16_t color',
    ]),
    method(G, 'drawRotatedRect', [
      'int16_t cenX',
      'int16_t cenY',
      'int16_t w',
      'int16_t h',
      'int16_t angleDeg',
      'uint16_t color',
    ]),
    method(G, 'fillRotatedRect', [
      'int16_t cenX',
      'int16_t cenY',
      'int16_t w',
      'int16_t h',
      'int16_t angleDeg',
      'uint16_t color',
    ]),
    method(G, 'rotatePoint', ['int16_t &x0', 'int16_t &y0', 'int16_t angleDeg']),
    // Bitmaps
    method(
      G,
      'drawBitmap',
      ['int16_t x', 'int16_t y', 'const uint8_t bitmap[]', 'int16_t w', 'int16_t h', 'uint16_t color'],
      'void',
      {
        overloads: [
          'void drawBitmap(int16_t x, int16_t y, const uint8_t bitmap[], int16_t w, int16_t h, uint16_t color, uint16_t bg)',
        ],
        example:
          'const uint8_t PROGMEM heart[] = { 0x66, 0xFF, 0xFF, 0x7E, 0x3C, 0x18, 0x00, 0x00 };\ndisplay.drawBitmap(60, 28, heart, 8, 8, SSD1306_WHITE);',
      },
    ),
    method(G, 'drawXBitmap', [
      'int16_t x',
      'int16_t y',
      'const uint8_t bitmap[]',
      'int16_t w',
      'int16_t h',
      'uint16_t color',
    ]),
    method(
      G,
      'drawGrayscaleBitmap',
      ['int16_t x', 'int16_t y', 'const uint8_t bitmap[]', 'int16_t w', 'int16_t h'],
      'void',
      {
        overloads: [
          'void drawGrayscaleBitmap(int16_t x, int16_t y, const uint8_t bitmap[], const uint8_t mask[], int16_t w, int16_t h)',
        ],
      },
    ),
    method(
      G,
      'drawRGBBitmap',
      ['int16_t x', 'int16_t y', 'const uint16_t bitmap[]', 'int16_t w', 'int16_t h'],
      'void',
      {
        overloads: [
          'void drawRGBBitmap(int16_t x, int16_t y, const uint16_t bitmap[], const uint8_t mask[], int16_t w, int16_t h)',
        ],
      },
    ),
    // Text
    method(
      G,
      'drawChar',
      ['int16_t x', 'int16_t y', 'unsigned char c', 'uint16_t color', 'uint16_t bg', 'uint8_t size'],
      'void',
      {
        overloads: [
          'void drawChar(int16_t x, int16_t y, unsigned char c, uint16_t color, uint16_t bg, uint8_t sizeX, uint8_t sizeY)',
        ],
      },
    ),
    method(G, 'setCursor', ['int16_t x', 'int16_t y'], 'void', {
      example: 'display.setCursor(0, 0);\ndisplay.print("Hello");',
    }),
    method(G, 'setTextColor', ['uint16_t color'], 'void', {
      overloads: ['void setTextColor(uint16_t color, uint16_t bg)'],
      example:
        'display.setTextColor(SSD1306_WHITE);                 // transparent background\ndisplay.setTextColor(SSD1306_BLACK, SSD1306_WHITE); // inverted text',
    }),
    method(G, 'setTextSize', ['uint8_t size'], 'void', {
      overloads: ['void setTextSize(uint8_t sizeX, uint8_t sizeY)'],
      example: 'display.setTextSize(2); // 12x16 pixel characters',
    }),
    method(G, 'setTextWrap', ['bool wrap']),
    method(G, 'setFont', ['const GFXfont *font = NULL'], 'void', {
      insert: 'setFont(&${1:font})',
      example:
        '#include <Fonts/FreeSans9pt7b.h>\n\ndisplay.setFont(&FreeSans9pt7b);\ndisplay.setFont(); // back to the built-in font',
    }),
    method(G, 'cp437', ['bool enable = true']),
    method(
      G,
      'getTextBounds',
      [
        'const char *str',
        'int16_t x',
        'int16_t y',
        'int16_t *x1',
        'int16_t *y1',
        'uint16_t *w',
        'uint16_t *h',
      ],
      'void',
      {
        overloads: [
          'void getTextBounds(const __FlashStringHelper *str, int16_t x, int16_t y, int16_t *x1, int16_t *y1, uint16_t *w, uint16_t *h)',
          'void getTextBounds(const String &str, int16_t x, int16_t y, int16_t *x1, int16_t *y1, uint16_t *w, uint16_t *h)',
        ],
        example:
          'int16_t x1, y1;\nuint16_t w, h;\ndisplay.getTextBounds("Hi", 0, 0, &x1, &y1, &w, &h);\ndisplay.setCursor((display.width() - w) / 2, 0); // centred',
      },
    ),
    method(G, 'getCursorX', [], 'int16_t'),
    method(G, 'getCursorY', [], 'int16_t'),
    // Display geometry
    method(G, 'setRotation', ['uint8_t rotation'], 'void', {
      example: 'display.setRotation(2); // upside down',
    }),
    method(G, 'getRotation', [], 'uint8_t'),
    method(G, 'width', [], 'int16_t'),
    method(G, 'height', [], 'int16_t'),
    method(G, 'invertDisplay', ['bool invert']),
    // Batched drawing (advanced)
    method(G, 'startWrite', []),
    method(G, 'writePixel', ['int16_t x', 'int16_t y', 'uint16_t color']),
    method(G, 'writeFillRect', ['int16_t x', 'int16_t y', 'int16_t w', 'int16_t h', 'uint16_t color']),
    method(G, 'writeFastHLine', ['int16_t x', 'int16_t y', 'int16_t w', 'uint16_t color']),
    method(G, 'writeFastVLine', ['int16_t x', 'int16_t y', 'int16_t h', 'uint16_t color']),
    method(G, 'writeLine', ['int16_t x0', 'int16_t y0', 'int16_t x1', 'int16_t y1', 'uint16_t color']),
    method(G, 'endWrite', []),
  ],
};
