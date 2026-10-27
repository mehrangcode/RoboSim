import { format } from '@wasm-fmt/clang-format/node';
import { describe, expect, it } from 'vitest';
import style from './arduino.clang-format?raw';
import { formatterFileName } from './format.js';

// The browser build loads the same WASM through Vite; here the Node build checks the style itself.

describe('sketch formatter (FR-COD-05)', () => {
  it('formats .ino files as C++ in the Arduino IDE 2 style (short blocks stay on one line)', () => {
    const src =
      'void setup(){\nSerial.begin(9600);pinMode(13,OUTPUT);\n}\nvoid loop(){for(int i=0;i<3;i++){delay(15);}}\n';
    expect(format(src, formatterFileName('sketch.ino'), style)).toBe(
      'void setup() {\n  Serial.begin(9600);\n  pinMode(13, OUTPUT);\n}\nvoid loop() {\n  for (int i = 0; i < 3; i++) { delay(15); }\n}\n',
    );
  });

  it('keeps include order and blank lines', () => {
    const src = '#include <Wire.h>\n#include <Adafruit_GFX.h>\n\n\nint x;\n';
    expect(format(src, 'main.cpp', style)).toBe(src);
  });
});
