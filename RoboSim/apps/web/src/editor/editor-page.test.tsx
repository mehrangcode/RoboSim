import { blankProject, addComponent, PITCH } from '@robosim/circuit-canvas';
import type { BuildResult, ProjectDocument } from '@robosim/shared';
import type { Frame, MainToWorker, SceneInfo } from '@robosim/sim-runtime/client';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../lib/i18n.js';
import type { CompileSketch } from '../lab/use-build.js';
import { FakeWorker } from '../testing/fake-worker.js';
import { EditorPage } from './editor-page.js';

const router = vi.hoisted(() => ({
  search: {} as { demo?: string },
  params: {} as { projectId?: string },
  navigate: vi.fn(),
}));
vi.mock('@tanstack/react-router', () => ({
  useSearch: () => router.search,
  useParams: () => router.params,
  useNavigate: () => router.navigate,
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

afterEach(() => {
  router.search = {};
  router.params = {};
  localStorage.clear();
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

  it('switches the centre pane to the robot for mounting (FR-ARN-09)', async () => {
    const robot = addComponent(
      addComponent(
        blankProject('Robot', 'void setup() {}\nvoid loop() {}\n'),
        'mechanical.chassis-2wd',
        [0, 0],
      ).doc,
      'sensor.line-3ch',
      [0, 0],
    ).doc;
    localStorage.setItem('robosim.editor.project.v1', JSON.stringify({ project: robot, pristine: '' }));
    const { user } = await setup();
    await user.click(screen.getByRole('radio', { name: 'Robot' }));
    expect(screen.getByRole('region', { name: 'Robot' })).toBeInTheDocument();
    expect(screen.queryByRole('application', { name: 'Circuit canvas' })).not.toBeInTheDocument();
    const tray = screen.getByRole('region', { name: 'Not on the robot' });
    await user.click(within(tray).getByRole('button', { name: 'Mount' }));
    expect(
      screen.getByRole('button', { name: /^3-channel line sensor \(line1\): x 65 mm/ }),
    ).toBeInTheDocument();
    // The mount is part of the document: undo takes it off again.
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(within(tray).getByRole('button', { name: 'Mount' })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Circuit' }));
    expect(screen.getByRole('application', { name: 'Circuit canvas' })).toBeInTheDocument();
  });

  it('picks an arena, edits the start pose and runs on it (FR-ARN-05, 06)', async () => {
    const robot = addComponent(
      blankProject('Robot', 'void setup() {}\nvoid loop() {}\n'),
      'mechanical.chassis-2wd',
      [0, 0],
    ).doc;
    localStorage.setItem('robosim.editor.project.v1', JSON.stringify({ project: robot, pristine: '' }));
    const { loads, user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Arena…' }));
    const picker = screen.getByRole('dialog', { name: 'Choose an arena' });
    for (const name of [
      'Oval',
      'Oval with gaps',
      'Figure eight',
      '90° turns',
      'Obstacle course',
      'Maze',
      'Sumo ring',
      'Open floor',
    ])
      expect(
        within(picker).getByRole('button', { name: new RegExp(`^${name} ?(Line|Obst|Maze|Sumo|Open)`) }),
      ).toBeInTheDocument();
    await user.click(within(picker).getByRole('button', { name: /^Obstacle course/ }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Arena: Obstacle course' })).toBeInTheDocument();

    // Exact start pose: onto a block is refused, beside it is taken.
    const x = screen.getByLabelText('x (cm)');
    expect(x).toHaveValue(30);
    await user.clear(x);
    await user.type(x, '95{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('overlap “block-1”');
    expect(x).toHaveValue(30);
    await user.clear(x);
    await user.type(x, '50{Enter}');
    expect(x).toHaveValue(50);

    await user.click(screen.getByRole('button', { name: 'Run' }));
    const load = loads().at(-1) as Extract<MainToWorker, { type: 'load'; project: ProjectDocument }>;
    expect(load.project.arena).toEqual({
      arenaVersionId: 'obstacle-course',
      startPose: { x: 0.5, y: 0.8, heading: 0 },
    });
    expect(load.project.successConditions?.id).toBe('obstacle-course-goal');
    await user.click(screen.getByRole('button', { name: 'Stop' }));

    // Open floor: free driving, its own start pose.
    await user.click(screen.getByRole('button', { name: 'Arena: Obstacle course' }));
    await user.click(screen.getByRole('button', { name: /^Open floor/ }));
    expect(screen.getByRole('img', { name: 'Arena: Open floor' })).toBeInTheDocument();
    expect(screen.getByLabelText('x (cm)')).toHaveValue(150);
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
