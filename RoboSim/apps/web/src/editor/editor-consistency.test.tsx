import { PITCH, addComponent, blankProject } from '@robosim/circuit-canvas';
import { BOARD_PART, type ProjectDocument } from '@robosim/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../lib/i18n.js';
import { FakeWorker } from '../testing/fake-worker.js';
import { EditorPage } from './editor-page.js';
import { runKey, saveStored } from './project-store.js';

// Wiring ↔ sketch check in the editor (FR-SAF-08, US-SAF-06): live while editing, no run needed.

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useParams: () => ({}),
  useNavigate: () => vi.fn(),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

/** An LED behind a resistor on D9, and a sketch that drives pin 5. */
function project(sketch: string): ProjectDocument {
  let doc = blankProject('Blink', '');
  doc = addComponent(doc, 'passive.resistor', [40 * PITCH, 4 * PITCH]).doc;
  doc = addComponent(doc, 'actuator.led', [50 * PITCH, 4 * PITCH]).doc;
  const [r, led] = doc.components;
  const wire = (id: string, from: [string, string], to: [string, string]) => ({
    id,
    from: { part: from[0], pin: from[1] },
    to: { part: to[0], pin: to[1] },
    color: 'red',
    points: [],
  });
  return {
    ...doc,
    wires: [
      wire('w1', [BOARD_PART, 'D9'], [r?.id ?? '', 'a']),
      wire('w2', [r?.id ?? '', 'b'], [led?.id ?? '', 'a']),
      wire('w3', [led?.id ?? '', 'k'], [BOARD_PART, 'GND1']),
    ],
    code: { ...doc.code, files: [{ name: 'sketch.ino', content: sketch }] },
  };
}

async function open(sketch: string) {
  const doc = project(sketch);
  saveStored({ project: doc, pristine: runKey(doc) });
  const i18n = await initI18n('en');
  const worker = new FakeWorker();
  render(
    <I18nextProvider i18n={i18n}>
      <EditorPage createWorker={() => worker} />
    </I18nextProvider>,
  );
  const user = userEvent.setup();
  // The analyser loads and runs 300 ms after the sketch settles; the tab count follows.
  await user.click(await screen.findByRole('radio', { name: /^Safety \(2\)$/ }, { timeout: 5000 }));
  return { user, worker };
}

/** The Safety tab's panel (the code pane lists the same findings next to the sketch). */
const safety = () =>
  within(screen.getByRole('heading', { name: 'Safety findings' }).parentElement as HTMLElement);

const SKETCH = 'void setup() {\n  pinMode(5, OUTPUT);\n}\nvoid loop() {\n  digitalWrite(5, HIGH);\n}\n';

describe('wiring ↔ sketch check in the editor (US-SAF-06)', () => {
  it('AC1/AC2: lists both findings while editing, with the run hint', async () => {
    await open(SKETCH);
    expect(safety().getByText('Wiring ↔ code (checked while you edit)')).toBeInTheDocument();
    expect(safety().getByText('Pin D5 is used in the code but not connected')).toBeInTheDocument();
    expect(safety().getByText('D9 is wired but never used in the code')).toBeInTheDocument();
    expect(safety().getByText('Run the project for the full electrical safety check.')).toBeInTheDocument();
    // Severity as icon + text, never colour only.
    const unused = safety().getByText('D9 is wired but never used in the code').closest('li') as HTMLElement;
    expect(within(unused).getByText('Info')).toBeInTheDocument();
  });

  it('AC2: "move the wire" fixes the circuit in one undoable step', async () => {
    const { user } = await open(SKETCH);
    const unwired = safety()
      .getByText('Pin D5 is used in the code but not connected')
      .closest('li') as HTMLElement;
    await user.click(within(unwired).getByRole('button', { name: 'Move the wire from D9 to D5' }));
    expect(await safety().findByText('No problems found.')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Undo' })[0] as HTMLElement);
    expect(await safety().findByText('Pin D5 is used in the code but not connected')).toBeInTheDocument();
  });

  it('AC2: "use the pin in code" rewrites every pin argument, then the findings clear', async () => {
    await open(SKETCH);
    const user = userEvent.setup();
    const unwired = safety()
      .getByText('Pin D5 is used in the code but not connected')
      .closest('li') as HTMLElement;
    await user.click(within(unwired).getByRole('button', { name: 'Use D9 in the code' }));
    expect(await safety().findByText('No problems found.', {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it('shows a finding on the circuit: its pin is ringed until hidden again', async () => {
    const { user } = await open(SKETCH);
    const unused = safety().getByText('D9 is wired but never used in the code').closest('li') as HTMLElement;
    await user.click(within(unused).getByRole('button', { name: 'Show on circuit' }));
    expect(screen.getByTestId('mark-board.D9')).toBeInTheDocument();
    await user.click(within(unused).getByRole('button', { name: 'Hide on circuit' }));
    expect(screen.queryByTestId('mark-board.D9')).toBeNull();
  });
});
