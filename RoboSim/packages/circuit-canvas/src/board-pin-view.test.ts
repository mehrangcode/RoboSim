import { BOARD_PART, type ComponentInstance, type ProjectDocument } from '@robosim/shared';
import { describe, expect, it } from 'vitest';
import { boardPinView } from './board-pin-view.js';
import { blankProject } from './document.js';

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
const ref = (s: string) => {
  const [part = '', pin = ''] = s.split('.');
  return { part, pin };
};
const doc = (parts: ComponentInstance[], wires: [string, string][] = []): ProjectDocument => ({
  ...blankProject('Test', ''),
  components: parts,
  wires: wires.map(([a, b], i) => ({ id: `w${i + 1}`, from: ref(a), to: ref(b), color: 'red', points: [] })),
});
const view = (d: ProjectDocument, pin: string) => boardPinView(d).find((v) => v.pin === pin);

describe('board pin view (FR-SAF-08)', () => {
  it('lists D0–D13 and A0–A5 with their capabilities; an empty board connects nothing', () => {
    const pins = boardPinView(doc([]));
    expect(pins.map((v) => v.pin)).toEqual([
      ...Array.from({ length: 14 }, (_, i) => `D${i}`),
      ...Array.from({ length: 6 }, (_, i) => `A${i}`),
    ]);
    expect(pins.find((v) => v.pin === 'D9')?.capabilities).toContain('pwm');
    expect(pins.every((v) => !v.connected && v.peers.length === 0 && v.wireIds.length === 0)).toBe(true);
  });

  it('follows a series resistor to the LED behind it, leaving the resistor out', () => {
    const d = doc(
      [part('r1', 'passive.resistor'), part('led1', 'actuator.led')],
      [
        [`${BOARD_PART}.D9`, 'r1.a'],
        ['r1.b', 'led1.a'],
        ['led1.k', `${BOARD_PART}.GND1`],
      ],
    );
    expect(view(d, 'D9')).toEqual({
      pin: 'D9',
      capabilities: expect.arrayContaining(['digital', 'pwm']) as unknown,
      // The whole signal path is highlighted, the wire behind the resistor too.
      wireIds: ['w1', 'w2'],
      boardWireIds: ['w1'],
      connected: true,
      peers: [{ partId: 'led1', type: 'actuator.led', pin: 'a', direction: 'none' }],
    });
  });

  it('a pull resistor to ground or a rail connects the pin but reaches no part', () => {
    const d = doc(
      [part('r1', 'passive.resistor')],
      [
        [`${BOARD_PART}.D2`, 'r1.a'],
        ['r1.b', `${BOARD_PART}.GND2`],
      ],
    );
    expect(view(d, 'D2')).toMatchObject({ connected: true, peers: [] });
  });

  it('takes directions from the pin kind, or the manifest `signalDirection`', () => {
    const d = doc(
      [part('servo', 'actuator.sg90-servo'), part('pir', 'sensor.pir'), part('dht', 'sensor.dht11')],
      [
        [`${BOARD_PART}.D9`, 'servo.signal'],
        [`${BOARD_PART}.D2`, 'pir.out'],
        [`${BOARD_PART}.D4`, 'dht.data'],
      ],
    );
    expect(view(d, 'D9')?.peers[0]?.direction).toBe('in');
    expect(view(d, 'D2')?.peers[0]?.direction).toBe('out');
    expect(view(d, 'D4')?.peers[0]?.direction).toBe('bidir');
  });

  it('reaches a part through breadboard strips; holes alone do not count as connected', () => {
    const bb = part('bb1', 'passive.breadboard-half');
    const led = part('led1', 'actuator.led', { seats: { a: { part: 'bb1', pin: '10a' } } });
    const seated = doc([bb, led], [[`${BOARD_PART}.D5`, 'bb1.10c']]);
    expect(view(seated, 'D5')).toMatchObject({
      connected: true,
      wireIds: ['w1'],
      boardWireIds: ['w1'],
      peers: [{ partId: 'led1', pin: 'a' }],
    });
    const empty = doc([bb], [[`${BOARD_PART}.D6`, 'bb1.20c']]);
    expect(view(empty, 'D6')).toMatchObject({ connected: false, peers: [], boardWireIds: ['w1'] });
  });

  it('two board pins wired together are connected to each other', () => {
    const d = doc([], [[`${BOARD_PART}.D3`, `${BOARD_PART}.GND1`]]);
    expect(view(d, 'D3')).toMatchObject({ connected: true, peers: [] });
  });
});
