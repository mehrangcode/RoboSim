import { type ApiTable, cls, constants, method } from './model.js';

const N = 'Adafruit_NeoPixel';

/** Adafruit NeoPixel 1.15.5 (`Adafruit_NeoPixel.h`): WS2812 / SK6812 addressable RGB(W) LEDs. */
export const ADAFRUIT_NEOPIXEL: ApiTable = {
  classes: [{ name: N, library: 'Adafruit_NeoPixel' }],
  entries: [
    cls(
      N,
      [
        'Adafruit_NeoPixel(uint16_t n, int16_t pin = 6, neoPixelType type = NEO_GRB + NEO_KHZ800)',
        'Adafruit_NeoPixel()',
      ],
      {
        example: 'Adafruit_NeoPixel strip(8, 6, NEO_GRB + NEO_KHZ800); // 8 LEDs on pin 6',
      },
    ),
    method(N, 'begin', [], 'bool', {
      example: 'void setup() {\n  strip.begin();\n  strip.show(); // all off\n}',
    }),
    method(N, 'show', [], 'void', {
      example:
        'strip.setPixelColor(0, strip.Color(255, 0, 0));\nstrip.show(); // send the colours to the LEDs',
    }),
    method(N, 'setPixelColor', ['uint16_t n', 'uint32_t color'], 'void', {
      overloads: [
        'void setPixelColor(uint16_t n, uint8_t r, uint8_t g, uint8_t b)',
        'void setPixelColor(uint16_t n, uint8_t r, uint8_t g, uint8_t b, uint8_t w)',
      ],
      example:
        'strip.setPixelColor(0, 255, 0, 0);           // first LED red\nstrip.setPixelColor(1, strip.Color(0, 0, 255)); // second LED blue',
    }),
    method(N, 'getPixelColor', ['uint16_t n'], 'uint32_t'),
    method(N, 'fill', ['uint32_t color = 0', 'uint16_t first = 0', 'uint16_t count = 0'], 'void', {
      insert: 'fill(${1:color})',
      example:
        'strip.fill(strip.Color(0, 255, 0)); // all green\nstrip.fill(strip.Color(255, 0, 0), 2, 3); // LEDs 2–4 red',
    }),
    method(N, 'clear', []),
    method(N, 'setBrightness', ['uint8_t brightness'], 'void', {
      example: 'strip.setBrightness(50); // about 20 %',
    }),
    method(N, 'getBrightness', [], 'uint8_t'),
    method(N, 'numPixels', [], 'uint16_t'),
    method(N, 'setPin', ['int16_t pin']),
    method(N, 'getPin', [], 'int16_t'),
    method(N, 'updateLength', ['uint16_t n']),
    method(N, 'updateType', ['neoPixelType type']),
    method(N, 'canShow', [], 'bool'),
    method(N, 'getPixels', [], 'uint8_t *'),
    method(
      N,
      'rainbow',
      [
        'uint16_t firstHue = 0',
        'int8_t reps = 1',
        'uint8_t saturation = 255',
        'uint8_t brightness = 255',
        'bool gammify = true',
      ],
      'void',
      { example: 'strip.rainbow();\nstrip.show();' },
    ),
    // Static helpers
    method(N, 'Color', ['uint8_t r', 'uint8_t g', 'uint8_t b'], 'uint32_t', {
      overloads: ['uint32_t Color(uint8_t r, uint8_t g, uint8_t b, uint8_t w)'],
      example: 'uint32_t orange = Adafruit_NeoPixel::Color(255, 100, 0);',
    }),
    method(N, 'ColorHSV', ['uint16_t hue', 'uint8_t sat = 255', 'uint8_t val = 255'], 'uint32_t', {
      example: 'strip.setPixelColor(0, strip.gamma32(strip.ColorHSV(21845))); // green',
    }),
    method(N, 'gamma32', ['uint32_t color'], 'uint32_t'),
    method(N, 'gamma8', ['uint8_t x'], 'uint8_t'),
    method(N, 'sine8', ['uint8_t x'], 'uint8_t'),
    ...constants(
      [
        'NEO_GRB',
        'NEO_RGB',
        'NEO_RBG',
        'NEO_GBR',
        'NEO_BRG',
        'NEO_BGR',
        'NEO_GRBW',
        'NEO_RGBW',
        'NEO_WRGB',
        'NEO_WRBG',
        'NEO_WGRB',
        'NEO_WGBR',
        'NEO_WBRG',
        'NEO_WBGR',
        'NEO_RWGB',
        'NEO_RWBG',
        'NEO_RGWB',
        'NEO_RBWG',
        'NEO_RBGW',
        'NEO_GWRB',
        'NEO_GWBR',
        'NEO_GRWB',
        'NEO_GBWR',
        'NEO_GBRW',
        'NEO_BWRG',
        'NEO_BWGR',
        'NEO_BRWG',
        'NEO_BRGW',
        'NEO_BGWR',
        'NEO_BGRW',
      ],
      'colour byte order (constructor type)',
      'Adafruit_NeoPixel.colorOrder',
    ),
    ...constants(['NEO_KHZ800', 'NEO_KHZ400'], 'data speed (constructor type)', 'Adafruit_NeoPixel.speed'),
  ],
};
