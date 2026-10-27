import { describe, expect, it } from 'vitest';
import { parseClip, readClip, serializeClip, writeClip } from './clipboard.js';
import {
  addComponent,
  addWire,
  blankProject,
  clipBox,
  copySelection,
  pasteClip,
  pasteOffset,
} from './document.js';
import { PITCH } from './geometry.js';
import { CircuitNets } from './nets.js';

/** The value, or a failed test when it is missing. */
function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected a value');
  return value;
}

const at = (gx: number, gy: number) => [gx * PITCH, gy * PITCH] as const;

/** Half breadboard with a resistor and an LED wired together, and a wire from the board to the resistor. */
function source() {
  let doc = blankProject('a', '');
  ({ doc } = addComponent(doc, 'passive.breadboard-half', at(0, 0)));
  ({ doc } = addComponent(doc, 'passive.resistor', at(10, 3)));
  ({ doc } = addComponent(doc, 'actuator.led', at(14, 5)));
  ({ doc } = addWire(doc, { part: 'r1', pin: 'b' }, { part: 'led1', pin: 'a' }, [], 'green'));
  ({ doc } = addWire(doc, { part: 'board', pin: 'D13' }, { part: 'r1', pin: 'a' }, [], 'yellow'));
  return doc;
}

describe('copy/paste between projects (FR-CIR-09)', () => {
  it('pastes into another project keeping the wiring inside the selection', () => {
    const clip = must(copySelection(source(), ['bb1']));
    expect(clip.components.map((c) => c.id)).toEqual(['bb1', 'r1', 'led1']);
    expect(clip.wires.map((w) => w.id)).toEqual(['w1']); // the wire to the board stays behind

    let target = blankProject('b', '');
    ({ doc: target } = addComponent(target, 'passive.resistor', at(-20, -20)));
    const parsed = must(parseClip(serializeClip(clip)));
    const pasted = pasteClip(target, parsed, pasteOffset(target, parsed, [100, 100]));
    expect(pasted.ids).toEqual(['bb1', 'r2', 'led1']);
    expect(pasted.doc.wires).toEqual([
      expect.objectContaining({ from: { part: 'r2', pin: 'b' }, to: { part: 'led1', pin: 'a' } }),
    ]);
    // Re-seated in the pasted breadboard, so the resistor and LED are still connected through it.
    expect(pasted.doc.components.find((c) => c.id === 'r2')?.seats?.['a']?.part).toBe('bb1');
    expect(new CircuitNets(pasted.doc).connectedTo({ part: 'r2', pin: 'b' })).toContainEqual({
      part: 'led1',
      pin: 'a',
    });
  });

  it('steps a paste off parts it would land on exactly', () => {
    const doc = source();
    const clip = must(copySelection(doc, ['r1']));
    const box = clipBox(doc, clip);
    // Centred on the original: it would cover it, so it moves two grid steps down-right.
    expect(pasteOffset(doc, clip, [box.x + box.w / 2, box.y + box.h / 2])).toEqual([2 * PITCH, 2 * PITCH]);
  });

  it('rejects text that is not a clip, from another schema version, or with unknown parts', () => {
    const clip = must(copySelection(source(), ['r1']));
    expect(parseClip('hello')).toBeNull();
    expect(parseClip(serializeClip(clip).replace('"schemaVersion":', '"schemaVersion":0,"x":'))).toBeNull();
    expect(
      parseClip(serializeClip({ ...clip, components: [{ ...must(clip.components[0]), type: 'nope.part' }] })),
    ).toBeNull();
  });

  it('falls back to the in-app copy when the system clipboard is unavailable', async () => {
    const clip = must(copySelection(source(), ['r1', 'led1']));
    await writeClip(clip); // jsdom has no Clipboard API
    expect((await readClip())?.components.map((c) => c.id)).toEqual(['r1', 'led1']);
  });
});
