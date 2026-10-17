import { blankProject, addComponent, PITCH } from '@robosim/circuit-canvas';
import type { BuildResult, ProjectDocument } from '@robosim/shared';
import type { Frame, SceneInfo } from '@robosim/sim-runtime/client';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../lib/i18n.js';
import type { CompileSketch } from '../lab/use-build.js';
import { FakeWorker } from '../testing/fake-worker.js';
import { EditorPage } from './editor-page.js';

const router = vi.hoisted(() => ({ search: {} as { demo?: string }, navigate: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({
  useSearch: () => router.search,
  useNavigate: () => router.navigate,
}));

afterEach(() => {
  router.search = {};
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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

const scene = (project: ProjectDocument, over: Partial<SceneInfo> = {}): SceneInfo => ({
  scenario: null,
  title: project.meta.title,
  kind: 'bench',
  staticFindings: [],
  pins: ['D13'],
  serial: false,
  code: project.code.files,
  project,
  parts: [],
  ...over,
});

const frame = (over: Partial<Frame> = {}): Frame => ({
  seq: 1,
  simTime: 1.25,
  rtf: 1,
  running: true,
  parts: {},
  pins: { D13: { mode: 'output', level: 1, volts: 4.7 } },
  faults: [],
  findings: [],
  damaged: { parts: [], pins: [] },
  ...over,
});

async function setup(
  compile: CompileSketch = vi.fn<CompileSketch>().mockResolvedValue({ result: built, hex: ':00000001FF\n' }),
) {
  const i18n = await initI18n('en');
  const worker = new FakeWorker();
  render(
    <I18nextProvider i18n={i18n}>
      <EditorPage createWorker={() => worker} compileSketch={compile} />
    </I18nextProvider>,
  );
  const loads = () => worker.sent.filter((m) => m.type === 'load');
  return { worker, compile, loads, user: userEvent.setup() };
}

const status = () =>
  screen.getByRole('toolbar', { name: 'Project and simulation' }).querySelector('[role=status]');

describe('editor workspace', () => {
  it('shows the panes around a starter project', async () => {
    await setup();
    for (const pane of ['Parts', 'Circuit', 'Code', 'Monitor'])
      expect(screen.getByRole('region', { name: pane })).toBeInTheDocument();
    expect(screen.getByRole('application', { name: 'Circuit canvas' })).toBeInTheDocument();
    expect(screen.getByLabelText<HTMLTextAreaElement>('Arduino code').value).toContain(
      'digitalWrite(13, HIGH)',
    );
    expect(status()).toHaveTextContent('Editing · press Run (F5) to simulate');
  });

  it('Run compiles, loads exactly the drawn project and shows live values; an edit stops it', async () => {
    const { worker, compile, loads, user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Run' }));
    expect(compile).toHaveBeenCalledTimes(1);
    const load = loads().at(-1) as Extract<
      (typeof worker.sent)[number],
      { type: 'load'; project: ProjectDocument }
    >;
    expect(load.project.components.map((c) => c.id)).toEqual(['bb1', 'r1', 'led1']);
    expect(load.firmware.sha256).toBe('c'.repeat(64));
    worker.load(scene(load.project));
    worker.frame(frame());
    expect(status()).toHaveTextContent(/1\.25/);
    await user.click(screen.getByRole('radio', { name: 'Pins' }));
    expect(screen.getByText('D13')).toBeInTheDocument();
    expect(screen.getByText(/press buttons and switches on the parts/)).toBeInTheDocument();

    // Editing the code stops the run; Run again rebuilds.
    await user.type(screen.getByLabelText('Arduino code'), '// x');
    expect(worker.sent.at(-1)).toEqual({ type: 'control', action: 'pause' });
    expect(status()).toHaveTextContent('Stopped: the project changed');
    await user.click(screen.getByRole('button', { name: 'Run' }));
    expect(compile).toHaveBeenCalledTimes(2);
  });

  it('multi-file sketch: a new header tab is saved and built with the .ino (US-COD-01 AC2)', async () => {
    const { compile, loads, user } = await setup();
    await user.click(screen.getByRole('button', { name: 'New file' }));
    const name = screen.getByLabelText('New file name');
    await user.type(name, 'other.ino');
    expect(screen.getByRole('alert')).toHaveTextContent('end the name in .h, .hpp, .c or .cpp');
    await user.clear(name);
    await user.type(name, 'motor.h{Enter}');
    expect(screen.getByRole('tab', { name: 'motor.h' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText<HTMLTextAreaElement>('Arduino code').value).toBe('#pragma once\n\n');
    await user.type(screen.getByLabelText('Arduino code'), 'const int MOTOR = 9;');

    await user.click(screen.getByRole('button', { name: 'New file' }));
    await user.type(screen.getByLabelText('New file name'), 'MOTOR.H');
    expect(screen.getByRole('alert')).toHaveTextContent('A file with this name already exists.');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await user.click(screen.getByRole('button', { name: 'Run' }));
    const files = vi.mocked(compile).mock.calls[0]?.[0].files ?? [];
    expect(files.map((f) => f.name).sort()).toEqual(['motor.h', 'sketch.ino']);
    expect(files.find((f) => f.name === 'motor.h')?.content).toContain('const int MOTOR = 9;');
    const load = loads().at(-1) as { project: ProjectDocument };
    expect(load.project.code.files).toHaveLength(2);

    // Rename, then delete after confirming; the .ino can be neither.
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    const rename = screen.getByLabelText('New name');
    await user.clear(rename);
    await user.type(rename, 'drive.h{Enter}');
    expect(screen.getByRole('tab', { name: 'drive.h' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Delete drive.h?');
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    expect(screen.queryByRole('tab', { name: 'drive.h' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'sketch.ino' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument();
  });

  it('diagnostics in another file open that file (FR-COD-03)', async () => {
    const { artifact: _, ...noArtifact } = built;
    const failed: BuildResult = {
      ...noArtifact,
      status: 'failed',
      diagnostics: [
        { file: 'motor.h', line: 1, column: 1, severity: 'error', message: "'x' does not name a type" },
      ],
    };
    const { user } = await setup(vi.fn<CompileSketch>().mockResolvedValue({ result: failed }));
    await user.click(screen.getByRole('button', { name: 'New file' }));
    await user.type(screen.getByLabelText('New file name'), 'motor.h{Enter}');
    await user.click(screen.getByRole('tab', { name: 'sketch.ino' }));
    await user.click(screen.getByRole('button', { name: 'Run' }));
    expect(screen.getByRole('tab', { name: /motor\.h/ })).toHaveTextContent('● 1');
    await user.click(screen.getByRole('button', { name: /does not name a type/ }));
    expect(screen.getByRole('tab', { name: /motor\.h/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('Pause/resume and Stop → Run do not rebuild an unchanged project', async () => {
    const { worker, compile, user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Run' }));
    const load = worker.sent.find((m) => m.type === 'load') as { project: ProjectDocument };
    worker.load(scene(load.project));
    worker.frame(frame());
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    expect(worker.sent.at(-1)).toEqual({ type: 'control', action: 'pause' });
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    await user.click(screen.getByRole('button', { name: 'Run' }));
    expect(compile).toHaveBeenCalledTimes(1);
    expect(worker.sent.at(-1)).toEqual({ type: 'control', action: 'run' });
  });

  it('presses a button on the canvas while running (FR-SIM-11)', async () => {
    const withButton = addComponent(
      blankProject('Btn', 'void setup() {}\nvoid loop() {}\n'),
      'sensor.push-button',
      [40 * PITCH, 4 * PITCH],
    ).doc;
    localStorage.setItem('robosim.editor.project.v1', JSON.stringify({ project: withButton, pristine: '' }));
    const { worker, user, loads } = await setup();
    await user.click(screen.getByRole('button', { name: 'Run' }));
    worker.load(scene((loads().at(-1) as { project: ProjectDocument }).project));
    worker.frame(frame({ parts: { btn1: { pressed: false } } }));
    const body = document.querySelector('[data-part-body="btn1"] > *') as Element;
    fireEvent.pointerDown(body, { button: 0 });
    expect(worker.sent.at(-1)).toEqual({ type: 'input', componentId: 'btn1', name: 'pressed', value: true });
  });

  it('opens a demo from ?demo= and runs it unchanged without the build service', async () => {
    router.search = { demo: 'dimmer' };
    const { worker, compile, user } = await setup();
    expect(worker.sent).toContainEqual({ type: 'load', scenario: 'dimmer' });
    expect(router.navigate).toHaveBeenCalledWith({ to: '/editor', search: {}, replace: true });
    const demo = blankProject('Knob dims an LED', 'void setup() {}\nvoid loop() {}\n');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    worker.load(scene(demo, { scenario: 'dimmer' }));
    expect(screen.getByRole('textbox', { name: 'Project name' })).toHaveValue('Knob dims an LED');
    await user.click(screen.getByRole('button', { name: 'Run' }));
    expect(compile).not.toHaveBeenCalled();
    expect(worker.sent.slice(-2)).toEqual([
      { type: 'load', scenario: 'dimmer' },
      { type: 'control', action: 'run' },
    ]);
  });

  it('asks before replacing a modified project', async () => {
    const { user } = await setup();
    await user.type(screen.getByLabelText('Arduino code'), '// mine');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await user.click(screen.getByRole('button', { name: 'New' }));
    expect(confirm).toHaveBeenCalled();
    expect(screen.getByLabelText<HTMLTextAreaElement>('Arduino code').value).toContain('// mine');
  });

  it('collapses and restores panes, remembering the layout', async () => {
    const { user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Hide Code' }));
    expect(screen.queryByRole('region', { name: 'Code' })).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('robosim.editor.layout.v1') ?? '{}').collapsed.code).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Show Code' }));
    expect(screen.getByRole('region', { name: 'Code' })).toBeInTheDocument();
    const handle = screen.getByRole('separator', { name: 'Resize Parts' });
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(handle).toHaveAttribute('aria-valuenow', '256');
  });

  it('shows the shortcuts with F1 and saves with Ctrl+S', async () => {
    await setup();
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1' })));
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true })));
    expect(screen.getByText('Saved in this browser.')).toBeInTheDocument();
  });

  it('below 768 px it is view-and-run only, in tabs', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: false,
      media: q,
      addEventListener() {},
      removeEventListener() {},
    }));
    await setup();
    expect(screen.getByRole('note')).toHaveTextContent('Editing needs a screen at least 768 px wide');
    expect(screen.queryByRole('button', { name: 'New' })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Circuit' })).toBeChecked();
    expect(screen.queryByRole('radio', { name: 'Code' })).not.toBeInTheDocument();
    expect(screen.getByText('View only: editing needs a larger screen')).toBeInTheDocument();
  });
});
