import { describe, expect, it } from 'vitest';
import { chatRequestSchema, putAiKeyRequestSchema } from './ai-api.js';
import {
  applyCircuitChanges,
  applyCodeEdits,
  diffLines,
  ProposalError,
  unifiedDiff,
  type PartResolver,
} from './ai-patch.js';
import { PROJECT_SCHEMA_VERSION, type ProjectDocument } from './project-schema.js';

const parts: PartResolver = {
  part: (type) =>
    type === 'passive.resistor'
      ? { version: '1.0.0', pins: ['1', '2'], props: { ohms: 220 } }
      : type === 'output.led'
        ? { version: '1.0.0', pins: ['anode', 'cathode'], props: { color: 'red' } }
        : undefined,
  boardPins: ['D13', 'D9', 'GND1', '5V'],
};

const doc: ProjectDocument = {
  schemaVersion: PROJECT_SCHEMA_VERSION,
  board: { id: 'avr-uno', version: '1.0.0' },
  components: [
    {
      id: 'r1',
      type: 'passive.resistor',
      typeVersion: '1.0.0',
      x: 10,
      y: 5,
      rotation: 0,
      flipped: false,
      props: { ohms: 220 },
    },
  ],
  wires: [
    {
      id: 'w1',
      from: { part: 'board', pin: 'D13' },
      to: { part: 'r1', pin: '1' },
      color: 'green',
      points: [],
    },
  ],
  code: { language: 'cpp', files: [{ name: 'main.ino', content: '' }] },
  libraries: [],
  meta: { name: 'Test' },
} as unknown as ProjectDocument;

describe('applyCodeEdits', () => {
  it('replaces unique text and appends with an empty find', () => {
    expect(applyCodeEdits('if (l > 500) go();', [{ find: '>', replace: '<' }])).toBe('if (l < 500) go();');
    expect(applyCodeEdits('a', [{ find: '', replace: 'b\n' }])).toBe('a\nb\n');
  });
  it('refuses missing or ambiguous text', () => {
    expect(() => applyCodeEdits('aa', [{ find: 'a', replace: 'b' }])).toThrow(/not unique/);
    expect(() => applyCodeEdits('aa', [{ find: 'c', replace: 'b' }])).toThrow(ProposalError);
  });
});

describe('diff', () => {
  it('keeps common lines and marks changes', () => {
    const d = diffLines('a\nb\nc', 'a\nB\nc\nd');
    expect(d.map((l) => `${l.kind[0]}${l.text}`)).toEqual(['sa', 'db', 'aB', 'sc', 'ad']);
  });
  it('writes hunks with 1-based line numbers', () => {
    const before = Array.from({ length: 10 }, (_, i) => `l${i + 1}`).join('\n');
    const after = before.replace('l5', 'L5');
    expect(unifiedDiff('main.ino', before, after, 1)).toBe(
      '--- a/main.ino\n+++ b/main.ino\n@@ -4,3 +4,3 @@\n l4\n-l5\n+L5\n l6\n',
    );
    expect(unifiedDiff('x', 'same', 'same')).toBe('');
  });
});

describe('applyCircuitChanges', () => {
  it('adds a part with defaults, wires it and sets a prop', () => {
    const next = applyCircuitChanges(
      doc,
      [
        { op: 'add_component', id: 'led1', type: 'output.led' },
        { op: 'add_wire', from: { part: 'r1', pin: '2' }, to: { part: 'led1', pin: 'anode' } },
        { op: 'add_wire', from: { part: 'led1', pin: 'cathode' }, to: { part: 'board', pin: 'GND1' } },
        { op: 'set_prop', id: 'r1', prop: 'ohms', value: 330 },
      ],
      parts,
    );
    expect(next.components.map((c) => c.id)).toEqual(['r1', 'led1']);
    expect(next.components[1]).toMatchObject({ props: { color: 'red' }, typeVersion: '1.0.0', x: 35 });
    expect(next.wires.map((w) => [w.id, w.color])).toEqual([
      ['w1', 'green'],
      ['w2', 'green'],
      ['w3', 'black'],
    ]);
    expect(next.components[0]?.props.ohms).toBe(330);
  });
  it('removes a part with its wires, and a wire in either direction', () => {
    expect(applyCircuitChanges(doc, [{ op: 'remove_component', id: 'r1' }], parts).wires).toEqual([]);
    const w = applyCircuitChanges(
      doc,
      [{ op: 'remove_wire', from: { part: 'r1', pin: '1' }, to: { part: 'board', pin: 'D13' } }],
      parts,
    );
    expect(w.wires).toEqual([]);
  });
  it('names the first change that does not fit', () => {
    const bad = (c: Parameters<typeof applyCircuitChanges>[1]) => () => applyCircuitChanges(doc, c, parts);
    expect(bad([{ op: 'add_component', id: 'x', type: 'nope' }])).toThrow('change 1: unknown part type nope');
    expect(
      bad([{ op: 'add_wire', from: { part: 'board', pin: 'D99' }, to: { part: 'r1', pin: '1' } }]),
    ).toThrow(/no pin D99/);
    expect(bad([{ op: 'set_prop', id: 'r1', prop: 'ohms', value: '1k' }])).toThrow(/must be a number/);
    expect(
      bad([{ op: 'add_wire', from: { part: 'r1', pin: '1' }, to: { part: 'board', pin: 'D13' } }]),
    ).toThrow(/exists/);
  });
});

describe('contracts', () => {
  it('defaults chat context and key scope', () => {
    expect(chatRequestSchema.parse({ message: ' hi ' })).toMatchObject({ message: 'hi', context: {} });
    expect(putAiKeyRequestSchema.parse({ key: 'sk-12345678' }).scope).toBe('user');
  });
});
