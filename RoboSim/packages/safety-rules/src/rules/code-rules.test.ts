import { analyzeSketch, initCodeAnalysis } from '@robosim/code-analysis';
import { nodeCodeAnalysisWasm } from '@robosim/code-analysis/node';
import { analyzeCircuit, assembleCircuit, type CircuitSpec, type StaticRule } from '@robosim/sim-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { UNO, def } from '../../test/helpers.js';
import { codeIsComplete, drivableMcuPins } from '../helpers.js';
import { codeFloatingInput, codeOutputConflict, codePwmPin, codeServoPwm } from './code-rules.js';
import { ledNoResistor } from './static-rules.js';

beforeAll(() => initCodeAnalysis(nodeCodeAnalysisWasm()));

const facts = (sketch: string) => analyzeSketch([{ name: 'sketch.ino', content: sketch }]);
const analyze = (rule: StaticRule, spec: CircuitSpec, sketch: string) =>
  analyzeCircuit(assembleCircuit(spec), [rule], UNO, facts(sketch));
const ids = (rule: StaticRule, spec: CircuitSpec, sketch: string) =>
  analyze(rule, spec, sketch).map(
    (f) =>
      `${f.ruleId}:${f.severity}:${[...f.componentIds, ...f.pinIds].join('+')}@${f.codeRefs?.map((r) => r.line).join(',')}`,
  );

const led = (pin: string): CircuitSpec => ({
  parts: { r: { def: def('passive.resistor'), props: { ohms: 220 } }, led: { def: def('actuator.led') } },
  wires: [
    [`mcu.${pin}`, 'r.a'],
    ['r.b', 'led.a'],
  ],
  ground: ['led.k'],
  mcuPins: [pin],
});

describe('FR-SAF-03 code-aware rules — trigger and clean fixtures', () => {
  it('US-SAF-02 AC1: analogWrite(7, …) warns on the code line and the pin, naming the PWM pins', () => {
    const [f, ...rest] = analyze(
      codePwmPin,
      led('D7'),
      'void setup() {}\nvoid loop() {\n  analogWrite(7, 128);\n}',
    );
    expect(rest).toEqual([]);
    expect(f).toMatchObject({
      ruleId: 'SAF-CODE-PWM-PIN',
      severity: 'warning',
      pinIds: ['D7'],
      params: { pin: 'D7', pwmPins: '3, 5, 6, 9, 10, 11' },
      codeRefs: [{ file: 'sketch.ino', line: 3, column: 3 }],
    });
    expect(ids(codePwmPin, led('D6'), 'void loop() { analogWrite(6, 128); }')).toEqual([]);
    expect(ids(codePwmPin, led('D7'), 'void loop() { digitalWrite(7, HIGH); }')).toEqual([]);
  });

  it('an output driven onto a part output, or onto another driven MCU pin, is an Error', () => {
    const sensor: CircuitSpec = {
      parts: { ir: { def: def('sensor.ir-obstacle') } },
      wires: [['ir.out', 'mcu.D4']],
      ground: ['ir.gnd'],
      mcuPins: ['D4'],
    };
    expect(
      ids(codeOutputConflict, sensor, 'const int IR = 4;\nvoid setup() {\n  pinMode(IR, OUTPUT);\n}'),
    ).toEqual(['SAF-CODE-OUTPUT-CONFLICT:error:ir+D4@3']);
    expect(ids(codeOutputConflict, sensor, 'void setup() { pinMode(4, INPUT); }')).toEqual([]);

    const tied: CircuitSpec = { parts: {}, wires: [['mcu.D2', 'mcu.D3']], ground: [], mcuPins: ['D2', 'D3'] };
    expect(
      ids(codeOutputConflict, tied, 'void setup() {\n  pinMode(2, OUTPUT);\n  analogWrite(3, 9);\n}'),
    ).toEqual(['SAF-CODE-OUTPUT-CONFLICT:error:D2+D3@2,3']);
    expect(ids(codeOutputConflict, tied, 'void setup() { pinMode(2, OUTPUT); pinMode(3, INPUT); }')).toEqual(
      [],
    );
  });

  it('a read input with nothing pulling it warns; INPUT_PULLUP or a resistor to a rail is clean', () => {
    const button: CircuitSpec = {
      parts: { b: { def: def('sensor.push-button') } },
      wires: [['b.a1', 'mcu.D2']],
      ground: ['b.b1'],
      mcuPins: ['D2'],
    };
    const read = 'void setup() {\n  pinMode(2, INPUT);\n}\nvoid loop() {\n  digitalRead(2);\n}';
    expect(ids(codeFloatingInput, button, read)).toEqual(['SAF-CODE-FLOATING-INPUT:warning:D2@2,5']);
    expect(analyze(codeFloatingInput, button, read)[0]?.params).toEqual({ pin: 'D2', pinArg: '2' });
    expect(
      ids(
        codeFloatingInput,
        button,
        'void setup() { pinMode(2, INPUT_PULLUP); } void loop() { digitalRead(2); }',
      ),
    ).toEqual([]);
    const pulledDown: CircuitSpec = {
      parts: {
        b: { def: def('sensor.push-button') },
        r: { def: def('passive.resistor'), props: { ohms: 10_000 } },
      },
      wires: [
        ['b.a1', 'mcu.D2'],
        ['mcu.D2', 'r.a'],
      ],
      ground: ['b.b1', 'r.b'],
      mcuPins: ['D2'],
    };
    expect(ids(codeFloatingInput, pulledDown, read)).toEqual([]);
    // An unresolved pinMode might be the pull-up: no guess.
    expect(
      ids(codeFloatingInput, button, `${read}\nint p = 2; void f() { pinMode(p, INPUT_PULLUP); }`),
    ).toEqual([]);
  });

  it('analogWrite on 9 or 10 with a servo attached warns; other PWM pins are clean', () => {
    const sketch = (pwm: number) =>
      `#include <Servo.h>\nServo s;\nvoid setup() {\n  s.attach(6);\n  analogWrite(${pwm}, 100);\n}`;
    expect(ids(codeServoPwm, led('D10'), sketch(10))).toEqual(['SAF-CODE-SERVO-PWM:warning:D10@5']);
    expect(ids(codeServoPwm, led('D5'), sketch(5))).toEqual([]);
    expect(ids(codeServoPwm, led('D10'), 'void setup() { analogWrite(10, 100); }')).toEqual([]);
  });

  it('every rule is silent without a sketch', () => {
    for (const rule of [codePwmPin, codeOutputConflict, codeFloatingInput, codeServoPwm])
      expect(analyzeCircuit(assembleCircuit(led('D7')), [rule], UNO)).toEqual([]);
  });
});

describe('drive probes follow the sketch when it names every pin it drives', () => {
  const noResistor: CircuitSpec = {
    parts: { led: { def: def('actuator.led') } },
    wires: [['mcu.D13', 'led.a']],
    ground: ['led.k'],
    mcuPins: ['D13'],
  };
  const ledFindings = (sketch: string) =>
    analyzeCircuit(assembleCircuit(noResistor), [ledNoResistor], UNO, facts(sketch)).length;

  it('a pin the sketch never drives is not probed; one it drives is', () => {
    expect(ledFindings('void loop() { digitalRead(13); }')).toBe(0);
    expect(ledFindings('void setup() { pinMode(LED_BUILTIN, OUTPUT); }')).toBe(1);
  });

  it('stays worst-case while the sketch is incomplete: unresolved pins, port registers, pin-driving libraries', () => {
    expect(ledFindings('int p = 13; void setup() { pinMode(p, OUTPUT); }')).toBe(1);
    expect(ledFindings('void setup() { DDRB = 0xFF; }')).toBe(1);
    expect(ledFindings('#include <LiquidCrystal.h>\nvoid setup() {}')).toBe(1);
    expect(codeIsComplete(facts('#include <Servo.h>\n#include <Wire.h>\nvoid setup() {}'))).toBe(true);
    expect(drivableMcuPins(assembleCircuit(noResistor), null)).toHaveLength(1);
  });
});
