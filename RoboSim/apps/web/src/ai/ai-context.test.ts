import { blankProject } from '@robosim/circuit-canvas';
import type { ProjectDocument } from '@robosim/shared';
import { describe, expect, it } from 'vitest';
import { chatContext, netsOf, serialTail } from './ai-context.js';

/** An LED plugged into a breadboard, fed from D13 through a wire into the same row as its anode. */
function project(): ProjectDocument {
  const doc = blankProject('t', 'void setup() {}\nvoid loop() {}\n');
  const part = (
    id: string,
    type: string,
    props: Record<string, number | string> = {},
    seats?: Record<string, { part: string; pin: string }>,
  ) => ({
    id,
    type,
    typeVersion: '1.0.0',
    x: 0,
    y: 0,
    rotation: 0 as const,
    flipped: false,
    props,
    ...(seats ? { seats } : {}),
  });
  return {
    ...doc,
    components: [
      part('bb1', 'passive.breadboard-half'),
      part(
        'led1',
        'actuator.led',
        { color: 'red' },
        { anode: { part: 'bb1', pin: '10a' }, cathode: { part: 'bb1', pin: '11a' } },
      ),
    ],
    wires: [
      {
        id: 'w1',
        from: { part: 'board', pin: 'D13' },
        to: { part: 'bb1', pin: '10e' },
        color: 'green',
        points: [],
      },
      {
        id: 'w2',
        from: { part: 'bb1', pin: '11e' },
        to: { part: 'board', pin: 'GND1' },
        color: 'black',
        points: [],
      },
    ],
  };
}

describe('AI context (FR-AI-01)', () => {
  it('names nets through breadboard rows without listing the holes', () => {
    expect(netsOf(project())).toEqual([
      // The Uno's GND pins are one net on the board itself.
      ['board:GND1', 'board:GND2', 'board:GND3', 'led1:cathode'],
      ['board:D13', 'led1:anode'],
    ]);
  });

  it('decodes the newest serial lines at the rate the sketch uses', () => {
    const bytes = new TextEncoder().encode('a\nb\nc\n');
    expect(serialTail([{ slice: 1, baud: 115200, bytes }], 2)).toEqual(['b', 'c']);
    expect(serialTail([])).toEqual([]);
  });

  it('leaves out empty parts', () => {
    const ctx = chatContext({
      doc: project(),
      currentFile: 'main.ino',
      serial: [],
      findings: [],
      diagnostics: [],
    });
    expect(Object.keys(ctx).sort()).toEqual(['currentFile', 'document', 'nets']);
  });
});
