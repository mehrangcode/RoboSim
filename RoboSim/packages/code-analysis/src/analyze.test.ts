import { beforeAll, describe, expect, it } from 'vitest';
import { analyzeSketch, initCodeAnalysis } from './index.js';
import { nodeCodeAnalysisWasm } from './node.js';

beforeAll(() => initCodeAnalysis(nodeCodeAnalysisWasm()));

const sketch = (content: string) => analyzeSketch([{ name: 'sketch.ino', content }]);
const pins = (content: string) =>
  sketch(content).uses.map((u) => [u.use, u.pin, ...(u.mode ? [u.mode] : [])]);

describe('pin usage (FR-COD-06)', () => {
  it('US-COD-06 AC1: analogWrite(7, 128) reports pin 7 as a PWM output, at its line and column', () => {
    expect(sketch('void setup() {}\nvoid loop() {\n  analogWrite(7, 128);\n}\n')).toEqual({
      uses: [{ pin: 'D7', use: 'analogWrite', at: { file: 'sketch.ino', line: 3, column: 3 } }],
      unresolved: [],
      includes: [],
    });
  });

  it('US-COD-06 AC2: resolves const int, constexpr byte, #define and arithmetic on them', () => {
    expect(
      pins(`
        #define LED 7
        #define NEXT (LED + 1)
        const int BTN = 2, BASE = 10;
        constexpr byte SPEAKER = BASE * 2 - 9;
        const uint8_t KNOB = A2;
        void setup() {
          pinMode(LED, OUTPUT);
          pinMode(NEXT, OUTPUT);
          pinMode(BTN, INPUT_PULLUP);
          tone(SPEAKER, 440);
          analogRead(KNOB);
          digitalWrite(LED_BUILTIN, HIGH);
        }`),
    ).toEqual([
      ['pinMode', 'D7', 'OUTPUT'],
      ['pinMode', 'D8', 'OUTPUT'],
      ['pinMode', 'D2', 'INPUT_PULLUP'],
      ['tone', 'D11'],
      ['analogRead', 'A2'],
      ['digitalWrite', 'D13'],
    ]);
  });

  it('reads analogRead channels and pin numbers, A0–A5 and digital numbers 14–19', () => {
    expect(pins('void f() { analogRead(0); analogRead(A5); analogRead(15); digitalRead(14); }')).toEqual([
      ['analogRead', 'A0'],
      ['analogRead', 'A5'],
      ['analogRead', 'A1'],
      ['digitalRead', 'A0'],
    ]);
  });

  it('finds Servo.attach on Servo objects only, including class members', () => {
    expect(
      pins(`
        #include <Servo.h>
        Servo arm;
        struct Gripper { Servo jaw; void begin() { jaw.attach(10); } };
        Stepper motor;
        void setup() { arm.attach(9, 544, 2400); motor.attach(3); }`),
    ).toEqual([
      ['servo', 'D10'],
      ['servo', 'D9'],
    ]);
  });

  it('finds the pin of DHT sensor objects, however the constructor is written', () => {
    const facts = sketch(`
        #include <DHT.h>
        const int DHT_PIN = 2;
        #define OUTSIDE 7
        DHT room(DHT_PIN, DHT11);
        DHT garden(OUTSIDE, DHT22), attic{A1, DHT11};
        DHT cellar = DHT(4, DHT11);
        struct Station { DHT probe{5, DHT11}; };
        DHT makeSensor(int pin, int type);
        int wired;
        DHT lost(wired, DHT11);`);
    expect(facts.uses.map((u) => [u.use, u.pin])).toEqual([
      ['dht', 'D2'],
      ['dht', 'D7'],
      ['dht', 'A1'],
      ['dht', 'D4'],
      ['dht', 'D5'],
    ]);
    expect(facts.uses[0]?.at).toEqual({ file: 'sketch.ino', line: 5, column: 9 });
    expect(facts.unresolved.map((u) => u.call)).toEqual(['DHT']);
  });

  it('lists calls whose pin or mode is not a constant as unresolved, without guessing', () => {
    const facts = sketch(`
      int led = 7;                 // not const: may change at run time
      const int pins[] = {2, 3};
      void blink(int p) { digitalWrite(p, HIGH); }
      void setup() {
        pinMode(led, OUTPUT);
        for (int i = 0; i < 2; i++) pinMode(pins[i], INPUT);
        pinMode(4, someMode());
        pinMode(99, OUTPUT);
      }`);
    expect(facts.uses).toEqual([]);
    expect(facts.unresolved.map((u) => [u.call, u.at.line])).toEqual([
      ['digitalWrite', 4],
      ['pinMode', 6],
      ['pinMode', 7],
      ['pinMode', 8],
      ['pinMode', 9],
    ]);
  });

  it('a name defined twice with different values, or circularly, is not a constant', () => {
    const facts = analyzeSketch([
      {
        name: 'a.ino',
        content:
          '#define PIN 3\n#define X Y\n#define Y X\nvoid f() { pinMode(PIN, OUTPUT); pinMode(X, OUTPUT); }',
      },
      { name: 'b.h', content: '#define PIN 5' },
    ]);
    expect(facts.uses).toEqual([]);
    expect(facts.unresolved).toHaveLength(2);
  });

  it('shares constants across tabs and reports each use in its own file', () => {
    const facts = analyzeSketch([
      { name: 'main.ino', content: '#include "pins.h"\nvoid setup() { pinMode(MOTOR, OUTPUT); }' },
      { name: 'pins.h', content: '#pragma once\nconst int MOTOR = 6;' },
      { name: 'drive.cpp', content: '#include "pins.h"\nvoid go() {\n  analogWrite(MOTOR, 200);\n}' },
    ]);
    expect(facts.uses).toEqual([
      { pin: 'D6', use: 'pinMode', mode: 'OUTPUT', at: { file: 'main.ino', line: 2, column: 16 } },
      { pin: 'D6', use: 'analogWrite', at: { file: 'drive.cpp', line: 3, column: 3 } },
    ]);
  });

  it("lists library includes (not the project's own files), and port register access as unresolved", () => {
    const facts = analyzeSketch([
      {
        name: 'a.ino',
        content:
          '#include <Servo.h>\n#include "pins.h"\n#include "Lib.h"\nvoid f() { DDRB |= 1; PORTB = 0; x = PINB; }',
      },
      { name: 'pins.h', content: '' },
    ]);
    expect(facts.includes).toEqual(['Servo.h', 'Lib.h']);
    expect(facts.unresolved.map((u) => u.call)).toEqual(['DDRB', 'PORTB']);
  });

  it('ignores comments, strings and user functions that are not pin calls', () => {
    expect(
      pins(`
        // analogWrite(7, 1);
        /* pinMode(8, OUTPUT); */
        const char *help = "digitalWrite(9, HIGH)";
        void myWrite(int p) {}
        void loop() { myWrite(5); Serial.println(analogRead(A0)); }`),
    ).toEqual([['analogRead', 'A0']]);
  });

  it('accepts hex, binary and suffixed literals; still parses around syntax errors', () => {
    expect(
      pins('void f() { pinMode(0x0D, OUTPUT); digitalWrite(0b11, 1); analogWrite(9u, 1); int = ; }'),
    ).toEqual([
      ['pinMode', 'D13', 'OUTPUT'],
      ['digitalWrite', 'D3'],
      ['analogWrite', 'D9'],
    ]);
  });
});
