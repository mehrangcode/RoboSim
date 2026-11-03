import { createI18n } from '@robosim/i18n';
import { BOARD_PART, type ProjectDocument } from '@robosim/shared';
import { fireEvent, render } from '@testing-library/react';
import type { i18n as I18n } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { CircuitCanvas, type CanvasMode, type CanvasProbe, type ProbeArm } from './circuit-canvas.js';
import { addComponent, addWire, blankProject } from './document.js';
import { PITCH } from './geometry.js';
import type { ProbeMarkers } from './probe-overlay.js';
import { useCircuitEditor } from './use-circuit-editor.js';

let i18n: I18n;
beforeAll(async () => {
  i18n = await createI18n({ lng: 'en', plugins: [initReactI18next] });
});

function project(): ProjectDocument {
  let doc = blankProject('t', '');
  doc = addComponent(doc, 'passive.resistor', [70 * PITCH, 4 * PITCH]).doc;
  return addWire(doc, { part: BOARD_PART, pin: 'D9' }, { part: 'r1', pin: 'a' }, [], 'yellow').doc;
}

function setup(mode: CanvasMode, armed: ProbeArm | null, markers: ProbeMarkers = {}) {
  const onPick = vi.fn();
  const onCancel = vi.fn();
  const probe: CanvasProbe = { armed, onPick, onCancel, markers };
  function Harness() {
    const editor = useCircuitEditor(project);
    return <CircuitCanvas editor={editor} mode={mode} onInput={() => undefined} probe={probe} />;
  }
  const view = render(
    <I18nextProvider i18n={i18n}>
      <Harness />
    </I18nextProvider>,
  );
  const svg = view.container.querySelector('svg[role="application"]') as Element;
  return { view, svg, onPick, onCancel };
}

describe('multimeter probes on the canvas (FR-SIM-13)', () => {
  it('an armed probe takes a pin click in run mode instead of the part interaction', () => {
    const { view, onPick } = setup('run', 'red');
    const pin = view.container.querySelector('[data-part="r1"][data-pin="b"]') as Element;
    fireEvent.pointerDown(pin, { button: 0 });
    expect(onPick).toHaveBeenCalledWith({ kind: 'pin', pin: { part: 'r1', pin: 'b' } });
  });

  it('in edit mode an armed probe does not start a wire; a wire click picks the wire', () => {
    const { view, onPick } = setup('edit', 'wire');
    const wire = view.container.querySelector('[data-wire] path') as Element;
    fireEvent.pointerDown(wire, { button: 0 });
    expect(onPick).toHaveBeenCalledWith({ kind: 'wire', wire: expect.any(String) as unknown });
    expect(view.container.querySelectorAll('[data-wire]')).toHaveLength(1);
  });

  it('not armed: clicks behave as before', () => {
    const { view, onPick } = setup('run', null);
    fireEvent.pointerDown(view.container.querySelector('[data-part="r1"][data-pin="a"]') as Element, {
      button: 0,
    });
    expect(onPick).not.toHaveBeenCalled();
  });

  it('draws + and COM tips (shape, not colour only) and Esc disarms', () => {
    const { view, svg, onCancel } = setup('view', 'black', {
      red: { part: 'r1', pin: 'a' },
      black: { part: BOARD_PART, pin: 'GND1' },
      part: 'r1',
    });
    expect(view.getByTestId('probe-red').textContent).toBe('+');
    expect(view.getByTestId('probe-black').textContent).toBe('COM');
    expect(view.getByTestId('probe-part')).toBeTruthy();
    expect(view.container.textContent).toContain('Click a pin or hole for the black (COM) probe');
    fireEvent.keyDown(svg, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });

  it('a measured wire shows a signed label with an arrow', () => {
    const { view } = setup('run', null, { wire: { id: 'w1', label: '−13.6 mA', reversed: true } });
    expect(view.getByTestId('probe-wire').textContent).toContain('13.6 mA');
  });
});
