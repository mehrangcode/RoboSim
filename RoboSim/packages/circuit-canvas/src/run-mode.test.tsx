import { createI18n } from '@robosim/i18n';
import type { ProjectDocument } from '@robosim/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import type { i18n as I18n } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { CircuitCanvas, type CanvasMode } from './circuit-canvas.js';
import { addComponent, blankProject } from './document.js';
import { PITCH } from './geometry.js';
import { interactionOf } from './interaction.js';
import { useCircuitEditor, type CircuitEditorState } from './use-circuit-editor.js';

let i18n: I18n;
beforeAll(async () => {
  i18n = await createI18n({ lng: 'en', plugins: [initReactI18next] });
});

function project(): ProjectDocument {
  let doc = blankProject('t', '');
  doc = addComponent(doc, 'sensor.push-button', [40 * PITCH, 4 * PITCH]).doc;
  doc = addComponent(doc, 'power.switch', [50 * PITCH, 4 * PITCH]).doc;
  doc = addComponent(doc, 'passive.potentiometer', [60 * PITCH, 8 * PITCH]).doc;
  return addComponent(doc, 'passive.resistor', [70 * PITCH, 4 * PITCH]).doc;
}

function setup(mode: CanvasMode, live: Record<string, unknown> = {}, damaged: string[] = []) {
  const onInput = vi.fn();
  const state: { current: CircuitEditorState | null } = { current: null };
  function Harness() {
    const editor = useCircuitEditor(project);
    state.current = editor;
    return <CircuitCanvas editor={editor} mode={mode} onInput={onInput} live={live} damaged={damaged} />;
  }
  const view = render(
    <I18nextProvider i18n={i18n}>
      <Harness />
    </I18nextProvider>,
  );
  const body = (id: string) => view.container.querySelector(`[data-part-body="${id}"] > *`) as Element;
  const svg = view.container.querySelector('svg[role="application"]') as Element;
  return { onInput, body, svg, editor: () => state.current as CircuitEditorState };
}

describe('canvas run mode (FR-SIM-11)', () => {
  it('maps manifest inputs to an interaction', () => {
    expect(interactionOf([{ name: 'pressed', type: 'boolean', default: false }])).toEqual({
      kind: 'momentary',
      input: 'pressed',
    });
    expect(interactionOf([{ name: 'on', type: 'boolean', default: false }])).toEqual({
      kind: 'toggle',
      input: 'on',
    });
    expect(interactionOf([{ name: 'position', type: 'number', default: 0.5 }])).toEqual({ kind: 'popover' });
    expect(interactionOf([])).toBeNull();
  });

  it('holds a push button while the pointer is down and toggles a switch', () => {
    const { onInput, body, svg } = setup('run', { sw1: { on: false } });
    fireEvent.pointerDown(body('btn1'), { button: 0 });
    expect(onInput).toHaveBeenLastCalledWith('btn1', 'pressed', true);
    fireEvent.pointerUp(svg);
    expect(onInput).toHaveBeenLastCalledWith('btn1', 'pressed', false);
    fireEvent.pointerDown(body('sw1'), { button: 0 });
    expect(onInput).toHaveBeenLastCalledWith('sw1', 'on', true);
  });

  it('opens sliders for a knob and sends the new position', () => {
    const { onInput, body } = setup('run', { pot1: { position: 0.5, wiperV: 2.5 } });
    fireEvent.pointerDown(body('pot1'), { button: 0 });
    const dialog = screen.getByRole('dialog', { name: 'Inputs of pot1' });
    fireEvent.change(screen.getByLabelText(/Knob position/), { target: { value: '0.2' } });
    expect(onInput).toHaveBeenLastCalledWith('pot1', 'position', 0.2);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(dialog).not.toBeInTheDocument();
  });

  it('does not edit the circuit while running; shows damaged parts with text', () => {
    const { body, svg, editor, onInput } = setup('run', {}, ['r1']);
    fireEvent.pointerDown(body('r1'), { button: 0 });
    fireEvent.keyDown(svg, { key: 'Delete' });
    expect(editor().doc.components).toHaveLength(4);
    expect(onInput).not.toHaveBeenCalled();
    expect(screen.getByText(/damaged/)).toBeInTheDocument();
  });

  it('view mode sends nothing', () => {
    const { onInput, body } = setup('view');
    fireEvent.pointerDown(body('btn1'), { button: 0 });
    expect(onInput).not.toHaveBeenCalled();
  });
});
