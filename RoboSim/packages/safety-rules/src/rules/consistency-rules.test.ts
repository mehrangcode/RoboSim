import { analyzeSketch, initCodeAnalysis } from '@robosim/code-analysis';
import { nodeCodeAnalysisWasm } from '@robosim/code-analysis/node';
import type { PinCapability } from '@robosim/sim-core';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  PIN_DIRECTION,
  PIN_UNUSED,
  PIN_UNWIRED,
  applyPinEdits,
  checkConsistency,
  sketchIsComplete,
  type BoardPinView,
  type PinPeer,
} from './consistency-rules.js';

beforeAll(() => initCodeAnalysis(nodeCodeAnalysisWasm()));

const PWM = new Set(['D3', 'D5', 'D6', 'D9', 'D10', 'D11']);
const PINS = [
  ...Array.from({ length: 14 }, (_, i) => `D${i}`),
  ...Array.from({ length: 6 }, (_, i) => `A${i}`),
];
const caps = (pin: string): PinCapability[] => [
  'digital',
  ...(PWM.has(pin) ? (['pwm'] as const) : []),
  ...(pin.startsWith('A') ? (['adc'] as const) : []),
];

/** An Uno with `wired` pins connected to the given peers through one board wire each. */
function board(wired: Readonly<Record<string, readonly PinPeer[] | 'bare'>> = {}): BoardPinView[] {
  return PINS.map((pin) => {
    const w = wired[pin];
    return {
      pin,
      capabilities: caps(pin),
      wireIds: w ? [`w-${pin}`] : [],
      boardWireIds: w ? [`w-${pin}`] : [],
      connected: w !== undefined,
      peers: w === undefined || w === 'bare' ? [] : w,
    };
  });
}
const led = (id = 'led'): PinPeer[] => [{ partId: id, type: 'actuator.led', pin: 'a', direction: 'none' }];
const servoIn: PinPeer[] = [{ partId: 'servo', type: 'actuator.sg90-servo', pin: 'signal', direction: 'in' }];

const run = (pins: BoardPinView[], sketch: string) =>
  checkConsistency(pins, analyzeSketch([{ name: 'sketch.ino', content: sketch }]));
const ids = (pins: BoardPinView[], sketch: string) =>
  run(pins, sketch).map((f) => `${f.ruleId}:${f.severity}:${f.pinIds.join('+')}`);

describe('wiring ↔ sketch consistency (FR-SAF-08)', () => {
  it('US-SAF-06 AC1: a pin used in code but connected to nothing is a warning on its code lines', () => {
    const [f, ...rest] = run(
      board(),
      'void setup() {\n  pinMode(5, OUTPUT);\n}\nvoid loop() { digitalWrite(5, HIGH); }',
    );
    expect(rest).toEqual([]);
    expect(f).toMatchObject({
      ruleId: PIN_UNWIRED,
      severity: 'warning',
      kind: 'consistency',
      pinIds: ['D5'],
      params: { pin: 'D5' },
      messageKey: 'safety:SAF-PIN-UNWIRED',
      learnMoreSlug: 'saf-pin-unwired',
    });
    expect(f?.codeRefs.map((r) => r.line)).toEqual([2, 4]);
  });

  it('US-SAF-06 AC2: a wired pin the complete sketch never uses is info, with fixes both ways', () => {
    const sketch = 'void setup() { pinMode(5, OUTPUT); }\nvoid loop() { digitalWrite(5, HIGH); }';
    const findings = run(board({ D9: led() }), sketch);
    expect(findings.map((f) => `${f.ruleId}:${f.severity}:${f.pinIds.join()}`)).toEqual([
      `${PIN_UNWIRED}:warning:D5`,
      `${PIN_UNUSED}:info:D9`,
    ]);
    const unused = findings[1];
    expect(unused?.componentIds).toEqual(['led']);
    expect(unused?.fixes).toEqual([
      {
        kind: 'code.replacePin',
        from: 'D5',
        to: 'D9',
        edits: [
          { file: 'sketch.ino', line: 1, column: 24, endColumn: 25, text: '5', replace: '9' },
          { file: 'sketch.ino', line: 2, column: 28, endColumn: 29, text: '5', replace: '9' },
        ],
      },
      { kind: 'wire.moveEnd', from: 'D9', to: 'D5', wireIds: ['w-D9'] },
    ]);
    // The unwired pin offers the same pair from its side.
    expect(findings[0]?.fixes.map((f) => `${f.kind}:${f.from}>${f.to}`)).toEqual([
      'code.replacePin:D5>D9',
      'wire.moveEnd:D9>D5',
    ]);
  });

  it('applies a code fix by span, and refuses a stale one', () => {
    const files = [
      { name: 'sketch.ino', content: '#define LED 5 // پایه\nvoid setup() { pinMode(LED, OUTPUT); }' },
    ];
    const [f] = run(board({ D9: led() }), files[0]?.content ?? '');
    const fix = f?.fixes.find((x) => x.kind === 'code.replacePin');
    expect(fix?.kind).toBe('code.replacePin');
    if (fix?.kind !== 'code.replacePin') return;
    expect(applyPinEdits(files, fix.edits)[0]?.content).toBe(
      '#define LED 9 // پایه\nvoid setup() { pinMode(LED, OUTPUT); }',
    );
    const changed = [{ name: 'sketch.ino', content: '#define LED 6 // پایه\nvoid setup() {}' }];
    expect(() => applyPinEdits(changed, fix.edits)).toThrow(/stale/);
  });

  it('only suggests pins with the capability the code needs (PWM for analogWrite, ADC for analogRead)', () => {
    const findings = run(
      board({ D2: led('a'), D6: led('b'), A1: led('c') }),
      'void loop() { analogWrite(5, 100); analogRead(A0); }',
    );
    const unwired = (pin: string) => findings.find((f) => f.ruleId === PIN_UNWIRED && f.pinIds[0] === pin);
    expect(unwired('D5')?.fixes.map((f) => f.to)).toEqual(['D6', 'D5']);
    expect(unwired('A0')?.fixes.map((f) => f.to)).toEqual(['A1', 'A0']);
  });

  it('US-SAF-06 AC3: reading a pin wired only to a part input is a direction warning', () => {
    expect(ids(board({ A0: servoIn }), 'void loop() { int v = analogRead(A0); }')).toEqual([
      `${PIN_DIRECTION}:warning:A0`,
    ]);
    expect(run(board({ A0: servoIn }), 'void loop() { analogRead(A0); }')[0]?.componentIds).toEqual([
      'servo',
    ]);
    // Written (even only to enable a pull-up), or wired to something that drives it: no finding.
    expect(ids(board({ A0: servoIn }), 'void loop() { analogRead(A0); digitalWrite(A0, HIGH); }')).toEqual(
      [],
    );
    const sensorOut: PinPeer[] = [{ partId: 's', type: 'sensor.pir', pin: 'out', direction: 'out' }];
    expect(ids(board({ D2: sensorOut }), 'void loop() { digitalRead(2); }')).toEqual([]);
    const bidir: PinPeer[] = [{ partId: 'dht', type: 'sensor.dht11', pin: 'data', direction: 'bidir' }];
    expect(ids(board({ D2: bidir }), 'void loop() { digitalRead(2); }')).toEqual([]);
    // A library input (NewPing echo) wired to a part input is the same mistake.
    expect(
      ids(
        board({ D11: servoIn, D12: led() }),
        '#include <NewPing.h>\nNewPing sonar(12, 11, 200);\nvoid loop() {}',
      ),
    ).toEqual([`${PIN_DIRECTION}:warning:D11`]);
  });

  it('US-SAF-06 AC4: unresolved pins give no finding, and an incomplete sketch hides "unused"', () => {
    expect(
      ids(
        board(),
        'int pins[] = {2, 3};\nvoid setup() { for (int i = 0; i < 2; i++) pinMode(pins[i], OUTPUT); }',
      ),
    ).toEqual([]);
    const incomplete = 'int p = 4;\nvoid setup() { pinMode(p, OUTPUT); pinMode(5, OUTPUT); }';
    expect(ids(board({ D5: led(), D9: led() }), incomplete)).toEqual([]);
    const unknownLib = '#include <LiquidCrystal.h>\nvoid setup() { pinMode(5, OUTPUT); }';
    expect(ids(board({ D5: led(), D9: led() }), unknownLib)).toEqual([]);
  });

  it('exempts the on-board LED, randomSeed, Serial, I²C and SPI pins', () => {
    expect(ids(board(), 'void loop() { digitalWrite(LED_BUILTIN, HIGH); }')).toEqual([]);
    expect(ids(board(), 'void setup() { randomSeed(analogRead(A0)); }')).toEqual([]);
    expect(ids(board({ D0: led(), D1: led() }), 'void setup() { Serial.begin(9600); }')).toEqual([]);
    expect(
      ids(
        board({ A4: led('lcd'), A5: led('lcd') }),
        '#include <Wire.h>\n#include <LiquidCrystal_I2C.h>\nvoid setup() {}',
      ),
    ).toEqual([]);
    expect(
      ids(board({ D10: led(), D11: led(), D12: led(), D13: led() }), '#include <SPI.h>\nvoid setup() {}'),
    ).toEqual([]);
    // Without Serial, a part on D0 the sketch never uses is reported like any other pin.
    expect(ids(board({ D0: led() }), 'void setup() {}')).toEqual([`${PIN_UNUSED}:info:D0`]);
  });

  it('a pin wired only to a resistor going nowhere counts as connected, but not as used by a part', () => {
    expect(ids(board({ D5: 'bare' }), 'void setup() { pinMode(5, OUTPUT); }')).toEqual([]);
    expect(ids(board({ D9: 'bare' }), 'void setup() {}')).toEqual([]);
  });

  it('returns nothing until the code analysis is ready', () => {
    expect(checkConsistency(board(), null)).toEqual([]);
  });

  it('sketchIsComplete: known libraries with constant pins only', () => {
    const facts = (s: string) => analyzeSketch([{ name: 'sketch.ino', content: s }]);
    expect(sketchIsComplete(facts('#include <NewPing.h>\nNewPing s(12, 11);'))).toBe(true);
    expect(sketchIsComplete(facts('#include <NewPing.h>\nint t = 12;\nNewPing s(t, 11);'))).toBe(false);
    expect(sketchIsComplete(facts('#include <Keypad.h>\nvoid setup() {}'))).toBe(false);
  });
});
