import { PITCH, addComponent, blankProject } from '@robosim/circuit-canvas';
import { BOARD_PART, type BuildResult, type ProjectDocument } from '@robosim/shared';
import type { MainToWorker } from '@robosim/sim-runtime/client';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompileSketch } from '../lab/use-build.js';
import { initI18n } from '../lib/i18n.js';
import { FakeWorker } from '../testing/fake-worker.js';
import { EditorPage } from './editor-page.js';
import { runKey, saveStored } from './project-store.js';

// Virtual multimeter in the editor (FR-SIM-13, US-SIM-09).

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

const built: BuildResult = {
  buildId: 'b1',
  status: 'succeeded',
  cacheHit: false,
  artifact: {
    id: 'c'.repeat(64),
    format: 'ihex',
    sha256: 'c'.repeat(64),
    sizeBytes: 11,
    flashPct: 3,
    ramPct: 0.4,
    url: '/api/v1/artifacts/ccc',
  },
  diagnostics: [],
  durationMs: 9,
};

/** 5 V → r1 → LED → GND. */
function project(): ProjectDocument {
  let doc = blankProject('Meter', '');
  doc = addComponent(doc, 'passive.resistor', [40 * PITCH, 4 * PITCH]).doc;
  doc = addComponent(doc, 'actuator.led', [50 * PITCH, 4 * PITCH]).doc;
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
      wire('w1', [BOARD_PART, '5V'], ['r1', 'a']),
      wire('w2', ['r1', 'b'], ['led1', 'a']),
      wire('w3', ['led1', 'k'], [BOARD_PART, 'GND1']),
    ],
    code: { ...doc.code, files: [{ name: 'sketch.ino', content: 'void setup() {}\nvoid loop() {}\n' }] },
  };
}

async function open() {
  const doc = project();
  saveStored({ project: doc, pristine: runKey(doc) });
  const i18n = await initI18n('en');
  const worker = new FakeWorker();
  const compile = vi.fn<CompileSketch>().mockResolvedValue({ result: built, hex: ':00000001FF\n' });
  const view = render(
    <I18nextProvider i18n={i18n}>
      <EditorPage createWorker={() => worker} compileSketch={compile} />
    </I18nextProvider>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole('radio', { name: 'Multimeter' }));
  return { user, worker, view, doc };
}

/** Starts the run and lets the fake worker report it loaded and running. */
async function run(user: ReturnType<typeof userEvent.setup>, worker: FakeWorker) {
  await user.click(screen.getByRole('button', { name: 'Run' }));
  const load = worker.sent.findLast((m) => m.type === 'load') as { project: ProjectDocument };
  worker.load({
    scenario: null,
    title: 'Meter',
    kind: 'bench',
    staticFindings: [],
    pins: [],
    serial: false,
    code: load.project.code.files,
    project: load.project,
    parts: [],
  });
  worker.frame({
    seq: 1,
    simTime: 0.5,
    rtf: 1,
    running: true,
    parts: {},
    pins: {},
    faults: [],
    findings: [],
    damaged: { parts: [], pins: [] },
  });
}

const lastMeasure = (worker: FakeWorker) =>
  worker.sent.findLast((m): m is Extract<MainToWorker, { type: 'measure' }> => m.type === 'measure');
const value = () => screen.getByTestId('meter-value').textContent;
const tick = () => act(() => new Promise((r) => setTimeout(r, 150)));

describe('multimeter in the editor (US-SIM-09)', () => {
  it('AC1: keyboard probe placement subscribes the meter; the readout follows the worker at ~10 Hz', async () => {
    const { user, worker } = await open();
    await run(user, worker);
    await user.selectOptions(screen.getByLabelText('Red probe (+)'), 'r1 · a');
    await user.selectOptions(screen.getByLabelText('Black probe (COM)'), 'r1 · b');
    expect(lastMeasure(worker)).toEqual({
      type: 'measure',
      channel: 'meter',
      probes: [{ kind: 'v', red: { part: 'r1', pin: 'a' }, black: { part: 'r1', pin: 'b' } }],
    });
    worker.reply({
      type: 'measures',
      channel: 'meter',
      session: 1,
      fromSlice: 0,
      slices: 30,
      data: Float32Array.from([3.01, 2.98, 3.02]),
    });
    await tick();
    expect(value()).toBe('3.010 V');
    // A mode through the LED's wire: 13–14 mA.
    await user.click(screen.getByRole('radio', { name: /Current/ }));
    await user.selectOptions(screen.getByLabelText('Current through'), 'Wire w2: r1.b → led1.a');
    expect(lastMeasure(worker)?.probes).toEqual([{ kind: 'i', pins: [{ part: 'r1', pin: 'b' }], scale: -1 }]);
    worker.reply({
      type: 'measures',
      channel: 'meter',
      session: 2,
      fromSlice: 30,
      slices: 30,
      data: Float32Array.from([0.0136, 0.0135, 0.0137]),
    });
    await tick();
    expect(value()).toBe('13.60 mA');
    expect(screen.getByTestId('probe-wire')).toHaveTextContent('13.60 mA');
  });

  it('places a probe with an armed click on the canvas; leaving the tab unsubscribes', async () => {
    const { user, worker, view } = await open();
    await user.click(screen.getByRole('button', { name: 'Place red (+)' }));
    expect(screen.getByText(/Click a pin or hole for the red/)).toBeInTheDocument();
    const pin = view.container.querySelector('[data-part="led1"][data-pin="a"]') as Element;
    fireEvent.pointerDown(pin, { button: 0 });
    expect(screen.getByLabelText('Red probe (+)')).toHaveDisplayValue('led1 · a');
    expect(screen.getByTestId('probe-red')).toBeInTheDocument();
    // No wire was started on the canvas by that click.
    expect(view.container.querySelectorAll('[data-wire]')).toHaveLength(3);
    await run(user, worker);
    expect(lastMeasure(worker)?.probes).toHaveLength(1);
    await user.click(screen.getByRole('radio', { name: 'Pins' }));
    expect(lastMeasure(worker)?.probes).toBeNull();
    expect(screen.queryByTestId('probe-red')).toBeNull();
  });

  it('AC2: Ω works on the edited circuit without a run; while running it asks to stop', async () => {
    const { user, worker } = await open();
    await user.click(screen.getByRole('radio', { name: /Resistance/ }));
    await user.selectOptions(screen.getByLabelText('Red probe (+)'), 'r1 · a');
    await user.selectOptions(screen.getByLabelText('Black probe (COM)'), 'r1 · b');
    const ask = worker.sent.findLast((m) => m.type === 'ohms') as Extract<MainToWorker, { type: 'ohms' }>;
    expect(ask).toMatchObject({ red: { part: 'r1', pin: 'a' }, black: { part: 'r1', pin: 'b' } });
    expect(ask.project?.wires).toHaveLength(3);
    worker.reply({ type: 'ohms', id: ask.id, ohms: 9990 });
    expect(await screen.findByText('9.990 kΩ')).toBeInTheDocument();
    await run(user, worker);
    expect(screen.getByTestId('meter-hint')).toHaveTextContent('Stop the run to measure resistance');
  });

  it('the toolbar button opens the meter tab', async () => {
    const { user } = await open();
    await user.click(screen.getByRole('radio', { name: 'Pins' }));
    await user.click(screen.getByRole('button', { name: 'Multimeter' }));
    expect(screen.getByRole('radio', { name: 'Multimeter' })).toBeChecked();
  });
});
