import { PITCH, addComponent, blankProject } from '@robosim/circuit-canvas';
import { BOARD_PART, type BuildResult, type ProjectDocument } from '@robosim/shared';
import type { InputLog, MainToWorker, PostMortem } from '@robosim/sim-runtime/client';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompileSketch } from '../lab/use-build.js';
import { initI18n } from '../lib/i18n.js';
import { FakeWorker } from '../testing/fake-worker.js';
import { EditorPage } from './editor-page.js';
import { runKey, saveStored } from './project-store.js';

// Damage post-mortem in the editor (FR-SIM-16, US-SIM-12).

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
  let doc = blankProject('Burn', '');
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
  return { user, worker, view, doc };
}

/** Starts the run and lets the fake worker report it loaded and running. */
async function run(user: ReturnType<typeof userEvent.setup>, worker: FakeWorker) {
  await user.click(screen.getByRole('button', { name: 'Run' }));
  const load = worker.sent.findLast((m) => m.type === 'load') as { project: ProjectDocument };
  worker.load({
    scenario: null,
    title: 'Burn',
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

/** led1 burnt at 6 s after 60 mA from 5.95 s. */
const burnt: PostMortem = {
  record: {
    slice: 6000,
    simTime: 6,
    componentIds: ['led1'],
    pins: [],
    reason: 'OVER_CURRENT',
    finding: {
      ruleId: 'SAF-COMPONENT-FAULT',
      severity: 'error',
      kind: 'runtime',
      componentIds: ['led1'],
      pinIds: [],
      messageKey: 'safety:SAF-COMPONENT-FAULT',
      params: { part: 'led1', code: 'OVER_CURRENT' },
    },
    conditionKey: 'SAF-COMPONENT-FAULT:led1:OVER_CURRENT',
    conditionSince: 5.95,
    pc: null,
  },
  series: [
    {
      key: 'led1:a:A',
      label: { part: 'led1', pin: 'a' },
      quantity: 'A',
      startSlice: 5951,
      intervalSlices: 1,
      data: new Float32Array(50).fill(0.06),
    },
  ],
  code: { serialLine: null, changedPins: [] },
};

const isLoad = (m: MainToWorker): m is Extract<MainToWorker, { type: 'load' }> => m.type === 'load';

describe('damage post-mortem in the editor (US-SIM-12)', () => {
  it('a damage announces a toast that opens the What happened? tab; Replay fast-forwards to 5 s before', async () => {
    const { user, worker } = await open();
    await run(user, worker);
    expect(screen.queryByRole('radio', { name: 'What happened?' })).toBeNull();
    worker.reply({ type: 'postmortem', ...burnt });
    worker.reply({ type: 'damaged', damaged: { parts: ['led1'], pins: [] } });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Part damaged: what happened?');
    await user.click(screen.getByRole('button', { name: 'What happened?' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('radio', { name: 'What happened?' })).toBeChecked();
    expect(screen.getByText(/the current into LED \(a\) reached 60\.00 mA/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Replay last 5 s' }));
    expect(worker.sent.at(-1)).toEqual({ type: 'exportLog' });
    const project = (worker.sent.findLast(isLoad) as { project: ProjectDocument }).project;
    const log: InputLog = {
      engineVersion: 'test',
      scenario: null,
      project,
      firmware: { format: 'ihex', text: ':00000001FF\n', sha256: 'c'.repeat(64) },
      seed: 3,
      entries: [
        { slice: 100, kind: 'serial', text: 'a' },
        { slice: 7000, kind: 'serial', text: 'after' },
      ],
      endSlice: 7500,
    };
    worker.reply({ type: 'inputLog', log });
    await vi.waitFor(() => expect(worker.sent.findLast(isLoad)).toHaveProperty('fastForwardTo'));
    expect(worker.sent.findLast(isLoad)).toMatchObject({
      type: 'load',
      seed: 3,
      inputLog: [{ slice: 100, kind: 'serial', text: 'a' }],
      fastForwardTo: 1000,
    });
    // The tab stays with the kept record while the replay reloads and fast-forwards.
    worker.load({
      scenario: null,
      title: 'Burn',
      kind: 'bench',
      staticFindings: [],
      pins: [],
      serial: false,
      code: project.code.files,
      project,
      parts: [],
    });
    worker.reply({ type: 'progress', done: 400, total: 1000 });
    expect(screen.getByText(/Replaying to 5 s before the damage… 40%/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(worker.sent.at(-1)).toEqual({ type: 'control', action: 'pause' });
  });
});
