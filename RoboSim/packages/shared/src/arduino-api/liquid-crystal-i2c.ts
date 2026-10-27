import { type ApiTable, cls, constants, method } from './model.js';

const L = 'LiquidCrystal_I2C';

/** LiquidCrystal_I2C 1.1.3 (`LiquidCrystal_I2C.h`): HD44780 character LCDs behind a PCF8574 I²C backpack. */
export const LIQUID_CRYSTAL_I2C: ApiTable = {
  classes: [{ name: L, library: 'LiquidCrystal_I2C', extends: ['Print'] }],
  entries: [
    cls(L, ['LiquidCrystal_I2C(uint8_t address, uint8_t cols, uint8_t rows)'], {
      example: 'LiquidCrystal_I2C lcd(0x27, 16, 2); // 16x2 LCD at address 0x27',
    }),
    method(L, 'init', [], 'void', {
      example: 'void setup() {\n  lcd.init();\n  lcd.backlight();\n  lcd.print("Hello!");\n}',
    }),
    method(L, 'begin', ['uint8_t cols', 'uint8_t rows', 'uint8_t charsize = LCD_5x8DOTS']),
    method(L, 'clear', []),
    method(L, 'home', []),
    method(L, 'setCursor', ['uint8_t col', 'uint8_t row'], 'void', {
      example: 'lcd.setCursor(0, 1); // first column, second row\nlcd.print("Temp: 25 C");',
    }),
    method(L, 'backlight', []),
    method(L, 'noBacklight', []),
    method(L, 'setBacklight', ['uint8_t value']),
    method(L, 'display', []),
    method(L, 'noDisplay', []),
    method(L, 'cursor', []),
    method(L, 'noCursor', []),
    method(L, 'blink', []),
    method(L, 'noBlink', []),
    method(L, 'scrollDisplayLeft', []),
    method(L, 'scrollDisplayRight', []),
    method(L, 'leftToRight', []),
    method(L, 'rightToLeft', []),
    method(L, 'autoscroll', []),
    method(L, 'noAutoscroll', []),
    method(L, 'createChar', ['uint8_t location', 'uint8_t charmap[]'], 'void', {
      example:
        'uint8_t heart[8] = { 0x00, 0x0A, 0x1F, 0x1F, 0x0E, 0x04, 0x00, 0x00 };\nlcd.createChar(0, heart);\nlcd.setCursor(0, 0);\nlcd.write(0); // draw it',
    }),
    method(L, 'command', ['uint8_t value']),
    method(L, 'printstr', ['const char text[]']),
    // Compatibility aliases
    method(L, 'cursor_on', []),
    method(L, 'cursor_off', []),
    method(L, 'blink_on', []),
    method(L, 'blink_off', []),
    method(L, 'load_custom_character', ['uint8_t location', 'uint8_t *charmap']),
    ...constants(['LCD_5x8DOTS', 'LCD_5x10DOTS'], 'character size (begin)', 'LiquidCrystal_I2C.charsize'),
  ],
};
