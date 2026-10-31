import {
  BOARD_PART,
  guidedStepSchema,
  type ComponentInstance,
  type GuidedStep,
  type ProjectDocument,
} from '@robosim/shared';
import { describe, expect, it } from 'vitest';
import { blankProject } from './document.js';
import { boardPinsOfKind, evaluateGuide, evaluateStep, type GuidedContext } from './guided.js';

const part = (id: string, type: string, extra: Partial<ComponentInstance> = {}): ComponentInstance => ({
  id,
  type,
  typeVersion: '1.0.0',
  x: 0,
  y: 0,
  rotation: 0,
  flipped: false,
  props: {},
  ...extra,
});
let n = 0;
const wire = (a: string, b: string) => {
  const [ap = '', apin = ''] = a.split('.');
  const [bp = '', bpin = ''] = b.split('.');
  return {
    id: `w${++n}`,
    from: { part: ap, pin: apin },
    to: { part: bp, pin: bpin },
    color: 'red',
    points: [],
  };
};
const doc = (parts: ComponentInstance[], wires: string[][] = []): ProjectDocument => ({
  ...blankProject('Robot', ''),
  components: parts,
  wires: wires.map(([a = '', b = '']) => wire(a, b)),
});
const ctx = (d: ProjectDocument, extra: Partial<GuidedContext> = {}): GuidedContext => ({
  doc: d,
  code: { uses: [] },
  runSucceeded: false,
  ...extra,
});
const step = (id: string, checks: unknown[] = []): GuidedStep =>
  guidedStepSchema.parse({ id, title: { en: id, fa: id }, body: { en: id, fa: id }, checks });

const in1Pwm = step('in1-pwm', [
  { kind: 'boardPin', pin: { type: 'driver.l298n', pin: 'in1' }, pinKind: 'pwm' },
]);

describe('guided checks (FR-LRN-01)', () => {
  it('lists board pins by kind', () => {
    expect(boardPinsOfKind('pwm')).toEqual(['D3', 'D5', 'D6', 'D9', 'D10', 'D11']);
    expect(boardPinsOfKind('analog')).toEqual(['A0', 'A1', 'A2', 'A3', 'A4', 'A5']);
    expect(boardPinsOfKind('digital')).not.toContain('D0');
    expect(boardPinsOfKind('ground')).toEqual(['GND1', 'GND2', 'GND3']);
  });

  it('US-LRN-01 AC1: IN1 on D5 completes the step, on D4 explains PWM pins', () => {
    const onD5 = evaluateStep(
      in1Pwm,
      ctx(doc([part('l298n1', 'driver.l298n')], [['l298n1.in1', 'board.D5']])),
    );
    expect(onD5).toEqual({ pass: true, failures: [] });

    const onD4 = evaluateStep(
      in1Pwm,
      ctx(doc([part('l298n1', 'driver.l298n')], [['board.D4', 'l298n1.in1']])),
    );
    expect(onD4.pass).toBe(false);
    expect(onD4.failures).toEqual([
      {
        reason: 'wrongPinKind',
        params: {
          type: 'driver.l298n',
          pin: 'in1',
          kind: 'pwm',
          options: 'D3, D5, D6, D9, D10, D11',
          boardPin: 'D4',
        },
        parts: ['l298n1'],
      },
    ]);
  });

  it('reports a missing part and an unwired pin', () => {
    expect(evaluateStep(in1Pwm, ctx(doc([]))).failures[0]?.reason).toBe('missingPart');
    expect(evaluateStep(in1Pwm, ctx(doc([part('d', 'driver.l298n')]))).failures[0]?.reason).toBe(
      'notOnBoard',
    );
  });

  it('counts parts and requires them on the robot when asked', () => {
    const motors = step('motors', [{ kind: 'part', type: 'actuator.tt-motor', count: 2, onRobot: true }]);
    const mount = { x: 0, y: 0, z: 0, yaw: 0 };
    expect(
      evaluateStep(motors, ctx(doc([part('m1', 'actuator.tt-motor', { mount })]))).failures[0],
    ).toMatchObject({
      reason: 'missingPart',
      params: { count: 2, have: 1 },
    });
    const loose = doc([part('m1', 'actuator.tt-motor', { mount }), part('m2', 'actuator.tt-motor')]);
    expect(evaluateStep(motors, ctx(loose)).failures[0]).toMatchObject({
      reason: 'notOnRobot',
      parts: ['m2'],
    });
    const both = doc([
      part('m1', 'actuator.tt-motor', { mount }),
      part('m2', 'actuator.tt-motor', { mount }),
    ]);
    expect(evaluateStep(motors, ctx(both)).pass).toBe(true);
  });

  it('requires a part on a servo horn when asked', () => {
    const scan = step('scan', [{ kind: 'part', type: 'sensor.hc-sr04', onServo: true }]);
    const servoMount = { x: 60, y: 0, z: 40, yaw: 0 };
    const servo = part('sv', 'actuator.sg90-servo', { mount: servoMount });
    expect(evaluateStep(scan, ctx(doc([servo, part('s', 'sensor.hc-sr04')]))).failures[0]?.reason).toBe(
      'notOnRobot',
    );
    const fixed = doc([servo, part('s', 'sensor.hc-sr04', { mount: { ...servoMount, z: 70 } })]);
    expect(evaluateStep(scan, ctx(fixed)).failures[0]).toMatchObject({ reason: 'notOnServo', parts: ['s'] });
    const onHorn = doc([
      servo,
      part('s', 'sensor.hc-sr04', { mount: { ...servoMount, z: 70, onServo: 'sv' } }),
    ]);
    expect(evaluateStep(scan, ctx(onHorn)).pass).toBe(true);
  });

  it('follows nets through the board’s joined grounds', () => {
    const gnd = step('gnd', [
      { kind: 'connected', a: { type: 'sensor.hc-sr04', pin: 'gnd' }, b: { type: BOARD_PART, pin: 'GND1' } },
      { kind: 'boardPin', pin: { type: 'sensor.hc-sr04', pin: 'vcc' }, pinKind: '5v' },
    ]);
    const d = doc(
      [part('s', 'sensor.hc-sr04')],
      [
        ['s.gnd', 'board.GND3'],
        ['s.vcc', 'board.5V'],
      ],
    );
    expect(evaluateStep(gnd, ctx(d)).pass).toBe(true);
    expect(evaluateStep(gnd, ctx(doc([part('s', 'sensor.hc-sr04')]))).failures.map((f) => f.reason)).toEqual([
      'notConnected',
      'notOnBoard',
    ]);
  });

  it('checks the sketch against the wiring', () => {
    const code = step('code', [
      { kind: 'code', use: 'analogWrite', at: { type: 'driver.l298n', pin: 'ena' } },
    ]);
    const d = doc([part('drv', 'driver.l298n')], [['drv.ena', 'board.D5']]);
    expect(evaluateStep(code, ctx(d, { code: { uses: [{ pin: 'D5', use: 'analogWrite' }] } })).pass).toBe(
      true,
    );
    expect(
      evaluateStep(code, ctx(d, { code: { uses: [{ pin: 'D6', use: 'analogWrite' }] } })).failures[0],
    ).toMatchObject({
      reason: 'codeMissing',
      params: { use: 'analogWrite', boardPin: 'D5' },
    });
    expect(evaluateStep(code, ctx(d, { code: null })).failures[0]?.reason).toBe('codeUnavailable');
  });

  it('checks library pin uses (Servo.attach, DHT) and names them in the hint', () => {
    const lib = step('lib', [
      { kind: 'code', use: 'servo', at: { type: 'actuator.sg90-servo', pin: 'signal' } },
      { kind: 'code', use: 'dht', at: { type: 'sensor.dht11', pin: 'data' } },
    ]);
    const d = doc(
      [part('servo', 'actuator.sg90-servo'), part('dht', 'sensor.dht11')],
      [
        ['servo.signal', 'board.D9'],
        ['dht.data', 'board.D2'],
      ],
    );
    const uses = [
      { pin: 'D9', use: 'servo' },
      { pin: 'D2', use: 'dht' },
    ];
    expect(evaluateStep(lib, ctx(d, { code: { uses } })).pass).toBe(true);
    expect(
      evaluateStep(lib, ctx(d, { code: { uses: [{ pin: 'D9', use: 'pinMode' }] } })).failures.map((f) => [
        f.reason,
        f.params['use'],
      ]),
    ).toEqual([
      ['codeMissing', 'Servo.attach'],
      ['codeMissing', 'DHT'],
    ]);
  });

  it('checks props and the run', () => {
    const jumper = step('jumper', [{ kind: 'prop', type: 'driver.l298n', prop: 'enaJumper', equals: false }]);
    expect(
      evaluateStep(jumper, ctx(doc([part('d', 'driver.l298n', { props: { enaJumper: true } })]))).pass,
    ).toBe(false);
    expect(
      evaluateStep(jumper, ctx(doc([part('d', 'driver.l298n', { props: { enaJumper: false } })]))).pass,
    ).toBe(true);
    // A prop the learner never changed has its catalogue default (added parts store no props).
    const red = step('red', [{ kind: 'prop', type: 'actuator.led', prop: 'color', equals: 'red' }]);
    expect(evaluateStep(red, ctx(doc([part('led', 'actuator.led')]))).pass).toBe(true);
    expect(
      evaluateStep(red, ctx(doc([part('led', 'actuator.led', { props: { color: 'green' } })]))).pass,
    ).toBe(false);
    expect(evaluateStep(jumper, ctx(doc([part('d', 'driver.l298n')]))).pass).toBe(false); // default: on
    const run = step('run', [{ kind: 'run' }]);
    expect(evaluateStep(run, ctx(doc([]))).failures[0]?.reason).toBe('notRun');
    expect(evaluateStep(run, ctx(doc([]), { runSucceeded: true })).pass).toBe(true);
  });
});

describe('guide progression', () => {
  const steps = [
    step('intro'),
    step('driver', [{ kind: 'part', type: 'driver.l298n' }]),
    in1Pwm,
    step('run', [{ kind: 'run' }]),
  ];

  it('runs steps in order; a reading step waits for confirmation', () => {
    const empty = evaluateGuide(steps, ctx(doc([])), new Set());
    expect(empty.statuses).toEqual(['active', 'locked', 'locked', 'locked']);
    expect(empty.current).toBe(0);

    const read = evaluateGuide(steps, ctx(doc([part('d', 'driver.l298n')])), new Set(['intro']));
    expect(read.statuses).toEqual(['done', 'done', 'active', 'locked']);
    expect(read.completedIds).toEqual(['intro', 'driver']);
  });

  it('does not complete later steps out of order', () => {
    const d = doc([], []);
    const state = evaluateGuide(steps, ctx(d, { runSucceeded: true }), new Set(['intro']));
    expect(state.statuses).toEqual(['done', 'active', 'locked', 'locked']);
    expect(state.completedIds).toEqual(['intro']);
  });

  it('flags an undone step for attention and completes when all pass', () => {
    const wired = doc([part('d', 'driver.l298n')], [['d.in1', 'board.D9']]);
    const done = evaluateGuide(steps, ctx(wired, { runSucceeded: true }), new Set(['intro']));
    expect(done.complete).toBe(true);
    expect(done.completedIds).toEqual(['intro', 'driver', 'in1-pwm', 'run']);

    const undone = evaluateGuide(steps, ctx(doc([part('d', 'driver.l298n')])), new Set(done.completedIds));
    expect(undone.statuses).toEqual(['done', 'done', 'attention', 'upcomingDone']);
    expect(undone.complete).toBe(false);
  });
});
