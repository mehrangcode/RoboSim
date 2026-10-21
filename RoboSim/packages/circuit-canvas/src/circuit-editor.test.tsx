import { createI18n } from '@robosim/i18n';
import type { ProjectDocument } from '@robosim/shared';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { i18n as I18n } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import { CircuitEditor } from './circuit-editor.js';
import { addComponent, blankProject } from './document.js';
import { PITCH } from './geometry.js';
import { normalizeSearch } from './search.js';
import { useCircuitEditor, type CircuitEditorState } from './use-circuit-editor.js';

let i18n: I18n;
beforeAll(async () => {
  i18n = await createI18n({ lng: 'en', plugins: [initReactI18next] });
});

function setup(initial: ProjectDocument = blankProject('Test', '')) {
  const state: { current: CircuitEditorState | null } = { current: null };
  function Harness() {
    const editor = useCircuitEditor(initial);
    state.current = editor;
    return <CircuitEditor editor={editor} />;
  }
  const view = render(
    <I18nextProvider i18n={i18n}>
      <Harness />
    </I18nextProvider>,
  );
  const editor = () => state.current as CircuitEditorState;
  const pin = (part: string, name: string) =>
    view.container.querySelector(`[data-part="${part}"][data-pin="${name}"]`) as Element;
  return { ...view, editor, pin };
}

describe('search normalisation', () => {
  it('treats Arabic and Persian letters, ZWNJ and digits alike', () => {
    expect(normalizeSearch('مقاومت‌ها ي ك ۱۲')).toBe(normalizeSearch('مقاومتها ی ک 12'));
  });
});

describe('circuit editor', () => {
  it('adds parts from the library, searchable in either language', async () => {
    const { editor } = setup();
    const user = userEvent.setup();
    await user.type(screen.getByRole('searchbox'), 'resis');
    const list = screen.getByRole('list', { name: 'Components' });
    expect(within(list).getAllByRole('button')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Add Resistor' }));
    expect(editor().doc.components.map((c) => c.type)).toEqual(['passive.resistor']);
    expect(editor().selection.parts).toEqual(['r1']);
    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'مقاومت');
    expect(within(list).getByRole('button', { name: 'Add Resistor' })).toBeInTheDocument();
  });

  it('draws a wire from a board pin to a part pin with a bend, then undoes it', () => {
    const { doc } = addComponent(blankProject('t', ''), 'actuator.led', [40 * PITCH, 4 * PITCH]);
    const { editor, pin, container } = setup(doc);
    const svg = container.querySelector('svg[role="application"]') as SVGSVGElement;
    fireEvent.pointerDown(pin('board', 'D13'), { button: 0 });
    fireEvent.pointerDown(svg, { button: 0, clientX: 100, clientY: 40 });
    fireEvent.pointerDown(pin('led1', 'a'), { button: 0 });
    expect(editor().doc.wires).toEqual([
      expect.objectContaining({
        from: { part: 'board', pin: 'D13' },
        to: { part: 'led1', pin: 'a' },
        color: 'yellow',
      }),
    ]);
    expect(editor().doc.wires[0]?.points).toHaveLength(1);
    act(() => editor().undo());
    expect(editor().doc.wires).toEqual([]);
  });

  it('a part plugged into a breadboard is drawn above the holes and can be selected and dragged', () => {
    let doc = addComponent(blankProject('t', ''), 'passive.breadboard-half', [32 * PITCH, 0]).doc;
    doc = addComponent(doc, 'actuator.led', [46 * PITCH, 4 * PITCH]).doc;
    const { editor, container } = setup(doc);
    expect(editor().doc.components[1]?.seats).toBeDefined();
    const hole = container.querySelector('[data-part="bb1"][data-pin="14b"]') as Element;
    const led = container.querySelector('[data-part-body="led1"]') as Element;
    // Later in the document = painted on top = receives the click.
    expect(hole.compareDocumentPosition(led) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const svg = container.querySelector('svg[role="application"]') as SVGSVGElement;
    fireEvent.pointerDown(led.firstElementChild as Element, { button: 0, clientX: 0, clientY: 0 });
    expect(editor().selection.parts).toEqual(['led1']);
    fireEvent.pointerMove(svg, { clientX: 400, clientY: 0 });
    fireEvent.pointerUp(svg);
    expect(editor().doc.wires).toEqual([]);
    expect(editor().doc.components[1]?.x).not.toBe(46 * PITCH);
  });

  it('colours a ground wire black and highlights the pin net on hover', () => {
    const { doc } = addComponent(blankProject('t', ''), 'actuator.led', [40 * PITCH, 4 * PITCH]);
    const { editor, pin } = setup(doc);
    fireEvent.pointerDown(pin('led1', 'k'), { button: 0 });
    fireEvent.pointerDown(pin('board', 'GND1'), { button: 0 });
    expect(editor().doc.wires[0]?.color).toBe('black');
    fireEvent.pointerOver(pin('board', 'GND3'));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Uno · GND3');
  });

  it('edits properties from the manifest and explains rejected values', async () => {
    const { doc } = addComponent(blankProject('t', ''), 'passive.resistor', [40 * PITCH, 4 * PITCH]);
    const { editor } = setup(doc);
    const user = userEvent.setup();
    act(() => editor().setSelection({ parts: ['r1'], wire: null }));
    const ohms = screen.getByLabelText(/^Resistance/);
    await user.clear(ohms);
    await user.type(ohms, '0{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('Must be between 0.1 and 10,000,000 Ω.');
    expect(editor().doc.components[0]?.props).toEqual({});
    await user.selectOptions(screen.getByLabelText('Standard value (E12)'), '4700');
    expect(editor().doc.components[0]?.props).toEqual({ ohms: 4700 });
    await user.click(screen.getByRole('button', { name: 'Rotate' }));
    expect(editor().doc.components[0]?.rotation).toBe(90);
  });

  it('deletes the selection with the keyboard and lists parts accessibly', async () => {
    let doc = blankProject('t', '');
    doc = addComponent(doc, 'passive.resistor', [40 * PITCH, 4 * PITCH]).doc;
    doc = addComponent(doc, 'actuator.led', [50 * PITCH, 4 * PITCH]).doc;
    const { editor, container } = setup(doc);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /LED\s*led1/ }));
    fireEvent.keyDown(container.querySelector('svg[role="application"]') as Element, { key: 'Delete' });
    expect(editor().doc.components.map((c) => c.id)).toEqual(['r1']);
  });

  it('selects with a band, aligns the group as one undo step, and keeps the board on delete', async () => {
    let doc = blankProject('t', '');
    doc = addComponent(doc, 'passive.resistor', [40 * PITCH, 4 * PITCH]).doc;
    doc = addComponent(doc, 'passive.resistor', [52 * PITCH, 9 * PITCH]).doc;
    doc = addComponent(doc, 'passive.resistor', [70 * PITCH, 2 * PITCH]).doc;
    const { editor, container } = setup(doc);
    const user = userEvent.setup();
    const svg = container.querySelector('svg[role="application"]') as SVGSVGElement;
    // jsdom has no layout: a band far beyond the view takes in everything, a tiny one nothing.
    fireEvent.pointerDown(svg, { button: 0, clientX: -1e5, clientY: -1e5 });
    fireEvent.pointerMove(svg, { clientX: 1e5, clientY: 1e5 });
    expect(container.querySelector('[data-testid="selection-band"]')).not.toBeNull();
    fireEvent.pointerUp(svg);
    expect(editor().selection.parts).toEqual(['board', 'r1', 'r2', 'r3']);
    expect(screen.getByRole('button', { name: /Distribute horizontally/ })).toBeEnabled();

    act(() => editor().setSelection({ parts: ['r1', 'r2', 'r3'], wire: null }));
    await user.click(screen.getByRole('button', { name: 'Align top edges' }));
    expect(new Set(editor().doc.components.map((c) => c.y))).toEqual(new Set([2 * PITCH]));
    act(() => editor().undo());
    expect(editor().doc).toEqual(doc);

    fireEvent.keyDown(svg, { key: 'a', ctrlKey: true });
    fireEvent.keyDown(svg, { key: 'Delete' });
    expect(editor().doc.components).toEqual([]);
    expect(container.querySelector('[data-part-body="board"]')).not.toBeNull();
  });

  it('a click on the board selects it; dragging moves it with its wires', () => {
    const { doc } = addComponent(blankProject('t', ''), 'actuator.led', [40 * PITCH, 4 * PITCH]);
    const { editor, pin, container } = setup(doc);
    fireEvent.pointerDown(pin('board', 'D13'), { button: 0 });
    fireEvent.pointerDown(pin('led1', 'a'), { button: 0 });
    const svg = container.querySelector('svg[role="application"]') as SVGSVGElement;
    const board = container.querySelector('[data-part-body="board"] rect') as Element;
    fireEvent.pointerDown(board, { button: 0, clientX: 0, clientY: 0 });
    expect(editor().selection.parts).toEqual(['board']);
    expect(screen.getByRole('heading', { name: 'Arduino Uno board' })).toBeInTheDocument();
    fireEvent.pointerMove(svg, { clientX: 0, clientY: 400 });
    fireEvent.pointerUp(svg);
    expect(editor().doc.board.position?.y).toBeGreaterThan(0);
    expect(editor().doc.wires).toHaveLength(1);
    fireEvent.keyDown(svg, { key: 'r' });
    expect(editor().doc.board.position?.rotation).toBe(90);
  });

  it('duplicates a selection with Ctrl+D, including the wires inside it', () => {
    let doc = blankProject('t', '');
    doc = addComponent(doc, 'passive.resistor', [40 * PITCH, 4 * PITCH]).doc;
    doc = addComponent(doc, 'actuator.led', [50 * PITCH, 4 * PITCH]).doc;
    const { editor, pin, container } = setup(doc);
    fireEvent.pointerDown(pin('r1', 'b'), { button: 0 });
    fireEvent.pointerDown(pin('led1', 'a'), { button: 0 });
    const svg = container.querySelector('svg[role="application"]') as SVGSVGElement;
    act(() => editor().setSelection({ parts: ['r1', 'led1'], wire: null }));
    fireEvent.keyDown(svg, { key: 'd', ctrlKey: true });
    expect(editor().selection.parts).toEqual(['r2', 'led2']);
    expect(editor().doc.wires.map((w) => `${w.from.part}-${w.to.part}`)).toEqual(['r1-led1', 'r2-led2']);
  });

  it('pans instead of selecting with the middle button, and toggles the minimap with M', () => {
    const { container } = setup();
    const svg = container.querySelector('svg[role="application"]') as SVGSVGElement;
    fireEvent.pointerDown(svg, { button: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(svg, { clientX: 50, clientY: 50 });
    expect(container.querySelector('[data-testid="selection-band"]')).toBeNull();
    fireEvent.pointerUp(svg);
    const toggle = screen.getByRole('button', { name: 'Show or hide the overview (M)' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('img', { name: /Circuit overview/ })).toBeInTheDocument();
    fireEvent.keyDown(svg, { key: 'm' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('img', { name: /Circuit overview/ })).toBeNull();
    expect(localStorage.getItem('robosim.circuit.minimap')).toBe('off');
  });
});
