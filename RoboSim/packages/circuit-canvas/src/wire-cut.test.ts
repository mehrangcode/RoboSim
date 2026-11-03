import { BOARD_PART, type ComponentInstance, type ProjectDocument } from '@robosim/shared';
import { describe, expect, it } from 'vitest';
import { blankProject } from './document.js';
import { CircuitNets } from './nets.js';
import { electricalPoint, wireCut } from './wire-cut.js';

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
const sorted = (pins: readonly { part: string; pin: string }[]) =>
  pins.map((p) => `${p.part}.${p.pin}`).sort();

describe('wireCut (FR-SIM-13 wire current)', () => {
  const series = () =>
    doc(
      [part('r1', 'passive.resistor'), part('led1', 'actuator.led')],
      [
        [`${BOARD_PART}.D9`, 'r1.a'],
        ['r1.b', 'led1.a'],
        ['led1.k', `${BOARD_PART}.GND1`],
      ],
    );

  it('tree: the from side, current from → to = −Σ I_in(side)', () => {
    expect(wireCut(series(), 'w2')).toEqual({ kind: 'tree', side: [ref('r1.b')], scale: -1 });
    expect(wireCut(series(), 'w1')).toEqual({ kind: 'tree', side: [ref(`${BOARD_PART}.D9`)], scale: -1 });
  });

  it('a side touching GND is never used: the other side is read with scale +1', () => {
    const d = series();
    const flipped = {
      ...d,
      wires: d.wires.map((w) => (w.id === 'w3' ? { ...w, from: w.to, to: w.from } : w)),
    };
    expect(wireCut(flipped, 'w3')).toEqual({ kind: 'tree', side: [ref('led1.k')], scale: 1 });
    expect(wireCut(d, 'w3')).toEqual({ kind: 'tree', side: [ref('led1.k')], scale: -1 });
  });

  it('loop: two wires in parallel have no defined current', () => {
    const d = series();
    const w2 = d.wires.find((w) => w.id === 'w2');
    if (!w2) throw new Error('fixture has no w2');
    const parallel = { ...d, wires: [...d.wires, { ...w2, id: 'w4' }] };
    expect(wireCut(parallel, 'w2')).toEqual({ kind: 'loop' });
    // GND pins are one conductor: two ground wires from one net form a loop too.
    const twoGrounds = doc(
      [part('led1', 'actuator.led')],
      [
        ['led1.k', `${BOARD_PART}.GND1`],
        ['led1.k', `${BOARD_PART}.GND2`],
      ],
    );
    expect(wireCut(twoGrounds, 'w1')).toEqual({ kind: 'loop' });
  });

  it('breadboard strips carry the side through; holes are not electrical pins', () => {
    const d = doc(
      [
        part('bb1', 'passive.breadboard-half'),
        part('r1', 'passive.resistor', { seats: { b: { part: 'bb1', pin: '14a' } } }),
        part('led1', 'actuator.led', { seats: { a: { part: 'bb1', pin: '14c' } } }),
      ],
      [
        [`${BOARD_PART}.D9`, 'r1.a'],
        ['bb1.14e', 'r1.a'], // jumper from strip 14 back to r1.a: not a loop, the path runs through r1
      ],
    );
    const cut = wireCut(d, 'w2');
    expect(cut?.kind).toBe('tree');
    if (cut?.kind !== 'tree') return;
    expect(sorted(cut.side)).toEqual(['led1.a', 'r1.b']);
  });

  it('bondedPins are one conductor inside the part', () => {
    const d = doc(
      [part('seg', 'display.seven-segment'), part('r1', 'passive.resistor')],
      [
        ['seg.com1', 'r1.a'],
        ['seg.com2', 'r1.b'],
      ],
    );
    expect(wireCut(d, 'w1')).toMatchObject({ kind: 'tree' });
    const cut = wireCut(d, 'w1');
    if (cut?.kind === 'tree') expect(sorted(cut.side)).toEqual(['r1.b', 'seg.com1', 'seg.com2']);
  });

  it('floating and unknown wires', () => {
    const d = doc(
      [part('bb1', 'passive.breadboard-half'), part('r1', 'passive.resistor')],
      [['bb1.1a', 'r1.a']],
    );
    expect(wireCut(d, 'w1')).toEqual({ kind: 'floating' });
    expect(wireCut(d, 'nope')).toBeNull();
  });

  it('electricalPoint: a hole maps to a part pin on its strip; an empty strip is floating', () => {
    const d = doc([
      part('bb1', 'passive.breadboard-half'),
      part('r1', 'passive.resistor', { seats: { b: { part: 'bb1', pin: '14a' } } }),
    ]);
    const nets = new CircuitNets(d);
    expect(electricalPoint(d, nets, ref('bb1.14e'))).toEqual(ref('r1.b'));
    expect(electricalPoint(d, nets, ref('bb1.20a'))).toBeNull();
    expect(electricalPoint(d, nets, ref('r1.a'))).toEqual(ref('r1.a'));
    expect(electricalPoint(d, nets, ref(`${BOARD_PART}.D3`))).toEqual(ref(`${BOARD_PART}.D3`));
  });

  it('400 wires on a full breadboard: within the TD budget (5 ms; ×10 headroom on CI)', () => {
    const parts = [part('bb1', 'passive.breadboard-full')];
    const wires: [string, string][] = [];
    for (let i = 0; i < 200; i++) {
      parts.push(part(`r${i}`, 'passive.resistor'));
      wires.push([`bb1.${(i % 60) + 1}a`, `r${i}.a`], [`r${i}.b`, `${BOARD_PART}.GND1`]);
    }
    const d = doc(parts, wires);
    wireCut(d, 'w1');
    const t0 = performance.now();
    for (let k = 0; k < 5; k++) wireCut(d, `w${2 * k + 1}`);
    const ms = (performance.now() - t0) / 5;
    expect(ms).toBeLessThan(50);
  });
});
