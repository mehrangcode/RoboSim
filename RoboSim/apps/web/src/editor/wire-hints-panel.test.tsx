import {
  DEFAULT_WIRE_CONVENTION,
  addComponent,
  addWire,
  blankProject,
  wireHints,
  type WireConvention,
} from '@robosim/circuit-canvas';
import { BOARD_PART, type ProjectDocument } from '@robosim/shared';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../lib/i18n.js';
import { FakeWorker } from '../testing/fake-worker.js';
import { EditorPage } from './editor-page.js';
import { useDismissedHints } from './use-wire-hints.js';
import { WireHintsPanel } from './wire-hints-panel.js';

vi.setConfig({ testTimeout: 20_000 });

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useParams: () => ({}),
  useNavigate: () => vi.fn(),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

afterEach(() => localStorage.clear());

/** An LED with its 5 V wire drawn black and its GND wire drawn red (US-CIR-08 AC1). */
function miswired(): ProjectDocument {
  let doc = addComponent(blankProject('t', ''), 'actuator.led', [100, 10]).doc;
  doc = addWire(doc, { part: BOARD_PART, pin: '5V' }, { part: 'led1', pin: 'a' }, [], 'black').doc;
  return addWire(doc, { part: BOARD_PART, pin: 'GND1' }, { part: 'led1', pin: 'k' }, [], 'red').doc;
}

async function renderPanel(doc: ProjectDocument, lng: 'en' | 'fa' = 'en') {
  const i18n = await initI18n(lng);
  const seen: { selected: string | null; convention: WireConvention; tidy: number } = {
    selected: null,
    convention: DEFAULT_WIRE_CONVENTION,
    tidy: 0,
  };
  function Harness() {
    const [selected, setSelected] = useState<string | null>(null);
    const [convention, setConvention] = useState(DEFAULT_WIRE_CONVENTION);
    const { dismissed, dismiss, restore } = useDismissedHints('p1');
    seen.selected = selected;
    seen.convention = convention;
    return (
      <WireHintsPanel
        doc={doc}
        hints={wireHints(doc, convention)}
        dismissed={dismissed}
        onDismiss={dismiss}
        onRestore={restore}
        selected={selected}
        onSelect={setSelected}
        convention={convention}
        onConventionChange={setConvention}
        onTidy={() => (seen.tidy += 1)}
      />
    );
  }
  const view = render(
    <I18nextProvider i18n={i18n}>
      <Harness />
    </I18nextProvider>,
  );
  return { ...view, seen, user: userEvent.setup() };
}

describe('wiring hints panel (FR-CIR-11)', () => {
  it('shows an Info hint on each mis-coloured wire, in words and not colour only (US-CIR-08 AC1)', async () => {
    await renderPanel(miswired());
    const items = within(screen.getByRole('list', { name: 'Wiring hints' })).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Info · Wiring hint');
    expect(items[0]).toHaveTextContent(/Supply wire Uno 5V → .* \(a\) is black/);
    expect(items[1]).toHaveTextContent(/Ground wire Uno GND1 → .* \(k\) is red/);
    expect(items[0]).toHaveTextContent('Red is usually +V, black GND.');
  });

  it('shows a hint on the circuit, and remembers a dismissed hint per project', async () => {
    const { seen, user, unmount } = await renderPanel(miswired());
    await user.click(screen.getAllByRole('button', { name: 'Show on circuit' })[0] as HTMLElement);
    expect(seen.selected).toMatch(/^LINT-WIRE-COLOR:w1/);
    expect(screen.getByRole('button', { name: 'Hide on circuit' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getAllByRole('button', { name: 'Dismiss' })[0] as HTMLElement);
    expect(seen.selected).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    unmount();

    // Reopened: the dismissal is still there, and can be undone.
    const again = await renderPanel(miswired());
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    await again.user.click(screen.getByRole('button', { name: 'Show dismissed (1)' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    await again.user.click(screen.getByRole('button', { name: 'Restore' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /dismissed/ })).toBeNull();
  });

  it('changes the colour convention from ⚙, never to the same colour for ground and supply', async () => {
    const { seen, user } = await renderPanel(miswired());
    await user.click(screen.getByRole('button', { name: 'Wire colour convention' }));
    const ground = screen.getByRole('combobox', { name: 'Ground (GND) wires' });
    expect(within(ground).queryByRole('option', { name: 'Red' })).toBeNull();
    act(() => {
      fireEvent.change(ground, { target: { value: 'blue' } });
    });
    expect(seen.convention).toEqual({ ground: 'blue', supply: 'red', signalAvoid: true });
    // The 5 V wire is still black, the GND wire is now wrong for blue as well.
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Reset to black / red' }));
    expect(seen.convention).toEqual(DEFAULT_WIRE_CONVENTION);
  });

  it('offers Tidy from the hints group, and reads in Persian', async () => {
    const { seen, user } = await renderPanel(miswired(), 'fa');
    expect(screen.getByRole('heading', { name: /راهنمای سیم‌کشی/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'مرتب‌سازی سیم‌ها…' }));
    expect(seen.tidy).toBe(1);
  });
});

describe('Tidy in the editor (FR-CIR-11)', () => {
  it('the command palette opens the tidy preview on the canvas', async () => {
    localStorage.setItem('robosim.editor.project.v1', JSON.stringify({ project: miswired(), pristine: '' }));
    const i18n = await initI18n('en');
    render(
      <I18nextProvider i18n={i18n}>
        <EditorPage createWorker={() => new FakeWorker()} />
      </I18nextProvider>,
    );
    const user = userEvent.setup();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const palette = screen.getByRole('dialog', { name: 'Command palette' });
    await user.type(within(palette).getByRole('combobox'), 'tidy');
    await user.keyboard('{Enter}');
    const bar = screen.getByRole('region', { name: 'Tidy wires' });
    expect(within(bar).getByRole('status')).toHaveTextContent('Wires changing: 2');
  });
});
