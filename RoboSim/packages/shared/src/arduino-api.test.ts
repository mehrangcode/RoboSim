import { describe, expect, it } from 'vitest';
import { ARDUINO_API } from './arduino-api.js';

describe('Arduino API table (code editor)', () => {
  it('has unique entries per owner and snippets with numbered placeholders', () => {
    const keys = ARDUINO_API.map((e) => `${e.of ?? ''}.${e.name}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(ARDUINO_API.find((e) => e.name === 'analogWrite')?.insert).toBe(
      'analogWrite(${1:pin}, ${2:value})',
    );
    expect(ARDUINO_API.find((e) => e.of === 'Serial' && e.name === 'begin')?.detail).toBe(
      'void Serial.begin(unsigned long baud)',
    );
  });
});
