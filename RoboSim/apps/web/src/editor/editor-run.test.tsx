import type { BuildResult, ProjectDocument } from '@robosim/shared';
import type { Frame, GradeJob, InputLog, SceneInfo } from '@robosim/sim-runtime/client';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompileSketch } from '../lab/use-build.js';
import type { GradeWorkerLike, VerifiedRun, VerifyReply } from '../lab/use-verified-run.js';
import { initI18n } from '../lib/i18n.js';
import { FakeWorker } from '../testing/fake-worker.js';
import { EditorPage } from './editor-page.js';

// Run controls, the live panels and verified runs in the editor (they lived in the retired Lab).

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useParams: () => ({}),
  useNavigate: () => vi.fn(),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Stand-in for the verify worker: records the job, lets the test answer it. */
class FakeGradeWorker implements GradeWorkerLike {
  jobs: GradeJob[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent<VerifyReply>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage(job: GradeJob): void {
    this.jobs.push(job);
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(msg: VerifyReply): void {
    act(() => this.onmessage?.({ data: msg } as MessageEvent<VerifyReply>));
  }
}

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

const frame = (over: Partial<Frame> = {}): Frame => ({
  seq: 1,
  simTime: 1.5,
  rtf: 1,
  running: true,
  parts: {},
  pins: { D13: { mode: 'output', level: 1, volts: 4.7 } },
  faults: [],
  findings: [],
  damaged: { parts: [], pins: [] },
  ...over,
});

/** Opens the editor, presses Run and lets the worker report the loaded project running. */
async function running(over: Partial<SceneInfo> = {}) {
  const i18n = await initI18n('en');
  const worker = new FakeWorker();
  const graders: FakeGradeWorker[] = [];
  const compile = vi.fn<CompileSketch>().mockResolvedValue({ result: built, hex: ':00000001FF\n' });
  render(
    <I18nextProvider i18n={i18n}>
      <EditorPage
        createWorker={() => worker}
        createGradeWorker={() => {
          const g = new FakeGradeWorker();
          graders.push(g);
          return g;
        }}
        compileSketch={compile}
      />
    </I18nextProvider>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Run' }));
  const load = worker.sent.findLast((m) => m.type === 'load') as { project: ProjectDocument };
  const scene: SceneInfo = {
    scenario: null,
    title: load.project.meta.title,
    kind: 'bench',
    staticFindings: [],
    pins: ['D13'],
    serial: false,
    code: load.project.code.files,
    project: load.project,
    parts: [],
    ...over,
  };
  worker.load(scene);
  worker.frame(frame());
  const log = (over: Partial<InputLog> = {}): InputLog => ({
    engineVersion: 'test',
    scenario: null,
    project: load.project,
    firmware: { format: 'ihex', text: ':00000001FF\n', sha256: 'c'.repeat(64) },
    seed: 3,
    entries: [],
    ...over,
  });
  return { worker, graders, user, scene, log, compile };
}

const status = () =>
  screen.getByRole('toolbar', { name: 'Project and simulation' }).querySelector('[role=status]');

describe('editor run controls and live panels', () => {
  it('offers a restart when the worker crashes; Run then loads into the fresh worker', async () => {
    const { worker, user, compile } = await running();
    act(() => worker.onerror?.({ message: 'RangeError: boom' } as ErrorEvent));
    expect(screen.getByRole('alert')).toHaveTextContent('The simulation stopped: RangeError: boom');
    worker.sent = [];
    await user.click(screen.getByRole('button', { name: 'Restart simulator' }));
    expect(screen.queryByRole('alert')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Run' }));
    expect(worker.sent.map((m) => m.type)).toEqual(expect.arrayContaining(['load', 'control']));
    expect(compile).toHaveBeenCalledTimes(1);
  });

  it('pause, reset and speed go to the worker', async () => {
    const { worker, user } = await running();
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    await user.click(screen.getByRole('radio', { name: '4×' }));
    expect(worker.sent).toEqual(
      expect.arrayContaining([
        { type: 'control', action: 'pause' },
        { type: 'control', action: 'reset' },
        { type: 'speed', value: 4 },
      ]),
    );
  });

  it('shows the live challenge checklist and result card, and Run again restarts it', async () => {
    const { worker, user } = await running();
    const challenge = {
      id: 'oval-one-lap',
      status: 'success' as const,
      decidedAt: 14.47,
      visitedZones: ['cp-right'],
      nextZone: null,
      tree: {
        type: 'all',
        status: 'met' as const,
        final: true,
        params: {},
        children: [
          {
            type: 'laps',
            status: 'met' as const,
            final: true,
            params: { laps: 1, count: 1, checkpoint: 3, checkpoints: 3 },
          },
          { type: 'onLineRatio', status: 'met' as const, final: true, params: { ratio: 0.97, min: 0.85 } },
        ],
      },
      score: { total: 99.6, max: 100, lines: [{ type: 'laps', weight: 60, points: 60 }] },
    };
    worker.frame(frame({ running: false, challenge }));
    await user.click(screen.getByRole('radio', { name: 'Challenge' }));
    expect(screen.getByText('Laps 1/1 · checkpoint 3/3')).toBeInTheDocument();
    expect(screen.getByText('On the line 97% (needs 85%)')).toBeInTheDocument();
    expect(screen.getByText('Challenge complete!')).toBeInTheDocument();
    expect(screen.getByText('Score 99.6/100')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Run again' }));
    expect(worker.sent.slice(-2)).toEqual([
      { type: 'control', action: 'reset' },
      { type: 'control', action: 'run' },
    ]);
  });

  it('serial monitor shows firmware output and sends a typed line', async () => {
    const { worker, user } = await running({ serial: true });
    const bytes = (s: string) => new TextEncoder().encode(s);
    worker.reply({
      type: 'serial',
      chunks: [
        { slice: 2, baud: 9615, bytes: bytes('RoboSim ready\r\n') },
        { slice: 1000, baud: 9615, bytes: bytes('tick 0\r\n') },
      ],
    });
    expect(screen.getByLabelText('Serial output')).toHaveTextContent('RoboSim ready tick 0');
    await user.type(screen.getByLabelText('Text to send'), 'hi{Enter}');
    expect(worker.sent.at(-1)).toEqual({ type: 'serial', text: 'hi\n' });
  });
});

describe('editor replay, input log and verified runs', () => {
  it('replay reloads the project and firmware from the input log and reports replayed inputs', async () => {
    const { worker, user, scene, log } = await running();
    await user.click(screen.getByRole('button', { name: 'Replay run' }));
    expect(worker.sent.at(-1)).toEqual({ type: 'exportLog' });
    const entries = [{ slice: 12, kind: 'serial' as const, text: 'x' }];
    const l = log({ entries });
    worker.reply({ type: 'inputLog', log: l });
    await vi.waitFor(() =>
      expect(worker.sent.slice(-2)).toEqual([
        { type: 'load', project: l.project, firmware: l.firmware, seed: 3, inputLog: entries },
        { type: 'control', action: 'run' },
      ]),
    );
    worker.load(scene, 1);
    worker.frame(frame());
    expect(status()).toHaveTextContent('replaying 1 input');
  });

  it('replay of a demo run reloads the demo by id', async () => {
    const { worker, user, log } = await running();
    await user.click(screen.getByRole('button', { name: 'Replay run' }));
    worker.reply({ type: 'inputLog', log: log({ scenario: 'blink', seed: 4 }) });
    await vi.waitFor(() =>
      expect(worker.sent.at(-2)).toEqual({ type: 'load', scenario: 'blink', seed: 4, inputLog: [] }),
    );
  });

  it('export downloads the input log as JSON named after the project', async () => {
    const { worker, user, log } = await running();
    const createObjectURL = vi.fn(() => 'blob:log');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await user.click(screen.getByRole('button', { name: 'Export input log' }));
    const l = log();
    worker.reply({ type: 'inputLog', log: l });
    await vi.waitFor(() => expect(click).toHaveBeenCalled());
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toMatch(/-seed3\.input-log\.json$/);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:log');
  });

  it('verify pauses, grades up to the same slice and compares it with the live run', async () => {
    const { worker, graders, user, log } = await running();
    await user.click(screen.getByRole('button', { name: 'Verify run' }));
    expect(worker.sent.slice(-2)).toEqual([{ type: 'control', action: 'pause' }, { type: 'exportLog' }]);
    const l = log({ endSlice: 1500 });
    worker.reply({ type: 'inputLog', log: l });
    await vi.waitFor(() => expect(graders[0]?.jobs).toEqual([{ log: l, maxSimSeconds: 1.5 }]));
    // The dock switches to the verified run.
    expect(screen.getByRole('radio', { name: 'Verified run' })).toBeChecked();
    expect(screen.getByText('Grading…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verify run' })).toBeDisabled();

    const live = frame({ running: false });
    worker.frame(live);
    const result: VerifiedRun = {
      engineVersion: 'test',
      seed: 3,
      outcome: 'unresolved',
      endSlice: 1500,
      challenge: null,
      score: null,
      staticFindings: [],
      damaged: { parts: [], pins: [] },
      final: { slice: 1500, pins: live.pins, parts: live.parts },
      serial: '',
    };
    graders[0]?.reply({ type: 'graded', result, samples: 16, digest: 'ab'.repeat(32), wallMs: 500 });
    expect(graders[0]?.terminated).toBe(true);
    expect(screen.getByText('No decision — ran to 1.50 s')).toBeInTheDocument();
    expect(screen.getByText('Identical to your run at 1.50 s')).toBeInTheDocument();
    expect(screen.getByTitle('ab'.repeat(32))).toHaveTextContent('abababababab');

    worker.frame(frame({ running: false, pins: { D13: { mode: 'output', level: 1, volts: 4.6 } } }));
    expect(screen.getByText('Differs from your run at 1.50 s')).toBeInTheDocument();
    worker.frame(frame({ simTime: 2 }));
    expect(screen.getByText('Your run has moved on — pause it to compare')).toBeInTheDocument();
  });

  it('verify shows grader errors, and Stop discards the verified run', async () => {
    const { worker, graders, user, log } = await running();
    await user.click(screen.getByRole('button', { name: 'Verify run' }));
    worker.reply({ type: 'inputLog', log: log({ endSlice: 9 }) });
    await vi.waitFor(() => expect(graders).toHaveLength(1));
    graders[0]?.reply({ type: 'error', message: 'Job needs engine x' });
    expect(screen.getByRole('alert')).toHaveTextContent('Verification failed: Job needs engine x');
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    expect(screen.queryByRole('radio', { name: 'Verified run' })).toBeNull();
    expect(screen.queryByText(/Verification failed/)).toBeNull();
  });
});
