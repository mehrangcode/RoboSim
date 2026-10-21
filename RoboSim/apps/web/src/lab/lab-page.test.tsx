import {
  type FindingView,
  type GradeJob,
  type InputLog,
  type Frame,
  type SceneInfo,
} from '@robosim/sim-runtime/client';
import { blankProject } from '@robosim/circuit-canvas';
import type { BuildResult } from '@robosim/shared';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { initI18n } from '../lib/i18n.js';
import { FakeWorker } from '../testing/fake-worker.js';
import { LabPage } from './lab-page.js';

// The Lab links to the editor; outside a router a plain anchor stands in for <Link>.
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    search,
    children,
    className,
  }: {
    to: string;
    search?: Record<string, string>;
    children: ReactNode;
    className?: string;
  }) => (
    <a href={`${to}?${new URLSearchParams(search).toString()}`} className={className}>
      {children}
    </a>
  ),
}));
import type { CompileSketch } from './use-build.js';
import type { GradeWorkerLike, VerifiedRun, VerifyReply } from './use-verified-run.js';

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

const benchScene: SceneInfo = {
  scenario: 'button',
  title: 'Button + LED',
  kind: 'bench',
  staticFindings: [],
  pins: ['D2', 'D13'],
  serial: false,
  code: [],
  project: blankProject('Button + LED', ''),
  parts: [
    { id: 'led', type: 'actuator.led', inputs: [] },
    { id: 'btn', type: 'sensor.push-button', inputs: [{ name: 'pressed', type: 'boolean', default: false }] },
  ],
};
const logBase = {
  engineVersion: 'test',
  project: {} as InputLog['project'],
  firmware: { format: 'ihex' as const, text: ':00000001FF', sha256: 'demo:x' },
};
const frame = (over: Partial<Frame> = {}): Frame => ({
  seq: 1,
  simTime: 1.5,
  rtf: 1,
  running: true,
  parts: { led: { color: 'green', brightness: 0.6, currentMa: 12.3 } },
  pins: { D2: { mode: 'input_pullup', level: 1, volts: 5 }, D13: { mode: 'output', level: 1, volts: 4.7 } },
  faults: [],
  findings: [],
  damaged: { parts: [], pins: [] },
  ...over,
});

async function setup(compileSketch: CompileSketch = vi.fn()) {
  const i18n = await initI18n('en');
  const worker = new FakeWorker();
  const graders: FakeGradeWorker[] = [];
  const createGradeWorker = () => {
    const g = new FakeGradeWorker();
    graders.push(g);
    return g;
  };
  render(
    <I18nextProvider i18n={i18n}>
      <LabPage
        createWorker={() => worker}
        createGradeWorker={createGradeWorker}
        compileSketch={compileSketch}
      />
    </I18nextProvider>,
  );
  return { worker, graders, user: userEvent.setup() };
}

describe('Simulator Lab', () => {
  it('safety demos: wiring findings before Run, damage after, warnings acknowledgeable', async () => {
    const { worker, user } = await setup();
    await user.click(screen.getByRole('radio', { name: 'Safety' }));
    expect(worker.sent).toContainEqual({ type: 'load', scenario: 'led-no-resistor' });
    const ledFinding: FindingView = {
      ruleId: 'SAF-LED-NO-RESISTOR',
      severity: 'error',
      kind: 'static',
      componentIds: ['led'],
      pinIds: ['D13'],
      messageKey: 'safety:SAF-LED-NO-RESISTOR',
      params: { part: 'led' },
    };
    const floating: FindingView = {
      ...ledFinding,
      ruleId: 'SAF-FLOATING-INPUT',
      severity: 'warning',
      kind: 'runtime',
      messageKey: 'safety:SAF-FLOATING-INPUT',
      params: { pin: 'D2' },
    };
    const ledPart = benchScene.parts.slice(0, 1);
    worker.load({ ...benchScene, scenario: 'led-no-resistor', staticFindings: [ledFinding], parts: ledPart });
    worker.frame(frame({ findings: [floating], damaged: { parts: ['led'], pins: ['D13'] } }));

    expect(screen.getByText('LED has no current-limiting resistor')).toBeInTheDocument();
    expect(screen.getByText('Pin D2 is a floating input')).toBeInTheDocument();
    expect(screen.getByText('Damaged')).toBeInTheDocument();
    expect(screen.getByText('damaged')).toBeInTheDocument(); // pin table

    await user.click(screen.getByRole('radio', { name: 'Errors' }));
    expect(screen.queryByText('Pin D2 is a floating input')).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'All' }));
    expect(screen.getAllByRole('button', { name: 'Got it' })).toHaveLength(1); // Errors cannot be acknowledged
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByText('Pin D2 is a floating input')).not.toBeInTheDocument();
    expect(screen.getByText('1 warning acknowledged')).toBeInTheDocument();
  });

  it('links each demo to the editor', async () => {
    const { user } = await setup();
    expect(screen.getByRole('link', { name: 'Open in editor →' })).toHaveAttribute(
      'href',
      '/editor?demo=line-follower',
    );
    await user.click(screen.getByRole('radio', { name: 'Component bench' }));
    expect(screen.getByRole('link', { name: 'Open in editor →' })).toHaveAttribute(
      'href',
      '/editor?demo=blink',
    );
  });

  it('loads and runs the line-follower arena by default', async () => {
    const { worker } = await setup();
    expect(worker.sent.slice(0, 2)).toEqual([
      { type: 'load', scenario: 'line-follower' },
      { type: 'control', action: 'run' },
    ]);
    expect(screen.getByRole('status')).toHaveTextContent('Loading the engine');
  });

  it('offers a restart when the worker crashes, and loads the demo again into the fresh worker', async () => {
    const { worker, user } = await setup();
    act(() => worker.onerror?.({ message: 'RangeError: boom' } as ErrorEvent));
    expect(screen.getByRole('alert')).toHaveTextContent('The simulation stopped: RangeError: boom');
    worker.sent = [];
    await user.click(screen.getByRole('button', { name: 'Restart simulator' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(worker.sent).toContainEqual({ type: 'load', scenario: 'line-follower' });
    expect(worker.sent).toContainEqual({ type: 'control', action: 'run' });
  });

  it('bench: shows parts and pins from the worker and sends button presses', async () => {
    const { worker, user } = await setup();
    await user.click(screen.getByRole('radio', { name: 'Component bench' }));
    await user.click(screen.getByRole('radio', { name: 'Button + LED' }));
    expect(worker.sent).toContainEqual({ type: 'load', scenario: 'button' });

    worker.load(benchScene);
    worker.frame(frame());
    expect(screen.getByRole('heading', { name: 'LED' })).toBeInTheDocument();
    expect(screen.getByText('12.3 mA')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Sim time 1.50 s');

    const hold = screen.getByRole('button', { name: 'Hold to press' });
    await user.pointer({ keys: '[MouseLeft>]', target: hold });
    expect(worker.sent).toContainEqual({ type: 'input', componentId: 'btn', name: 'pressed', value: true });
    await user.pointer({ keys: '[/MouseLeft]', target: hold });
    expect(worker.sent.at(-1)).toEqual({ type: 'input', componentId: 'btn', name: 'pressed', value: false });
  });

  it('pause, reset and speed go to the worker', async () => {
    const { worker, user } = await setup();
    worker.load({ ...benchScene, scenario: 'line-follower', kind: 'bench' });
    worker.frame(frame());
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

  it('arena: shows the live challenge checklist and the result card with score', async () => {
    const { worker, user } = await setup();
    worker.load({ ...benchScene, scenario: 'line-follower', kind: 'bench', parts: [] });
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
          { type: 'timeLimit', status: 'met' as const, final: true, params: { time: 14.47, seconds: 60 } },
          { type: 'onLineRatio', status: 'met' as const, final: true, params: { ratio: 0.97, min: 0.85 } },
        ],
      },
      score: {
        total: 99.6,
        max: 100,
        lines: [
          { type: 'laps', weight: 60, points: 60 },
          { type: 'timeBonus', weight: 25, points: 25 },
          { type: 'onLineRatio', weight: 15, points: 14.6 },
        ],
      },
    };
    worker.frame(frame({ running: false, challenge }));
    expect(screen.getByText('Laps 1/1 · checkpoint 3/3')).toBeInTheDocument();
    expect(screen.getByText('On the line 97% (needs 85%)')).toBeInTheDocument();
    expect(screen.getByText('Challenge complete!')).toBeInTheDocument();
    expect(screen.getByText('Score 99.6/100')).toBeInTheDocument();
    expect(screen.getByText('Decided at 14.47 s of simulated time')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Run again' }));
    expect(worker.sent.slice(-2)).toEqual([
      { type: 'control', action: 'reset' },
      { type: 'control', action: 'run' },
    ]);
  });

  it('serial demo: shows the firmware output and sends a typed line', async () => {
    localStorage.removeItem('robosim.serial.v1');
    const { worker, user } = await setup();
    await user.click(screen.getByRole('radio', { name: 'Component bench' }));
    await user.click(screen.getByRole('radio', { name: 'Serial Monitor' }));
    expect(worker.sent).toContainEqual({ type: 'load', scenario: 'serial' });
    worker.load({
      ...benchScene,
      scenario: 'serial',
      pins: ['D13'],
      parts: benchScene.parts.slice(0, 1),
      serial: true,
    });
    worker.frame(frame());
    expect(screen.getByLabelText('Serial output')).toHaveTextContent('Nothing received yet.');
    // Serial.begin(9600) on a 16 MHz Uno really runs at 9615 baud.
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
    expect(screen.getByLabelText('Text to send')).toHaveValue('');

    await user.click(screen.getByRole('checkbox', { name: 'Timestamps' }));
    expect(screen.getByLabelText('Serial output')).toHaveTextContent(
      '00:00.002 -> RoboSim ready 00:01.000 -> tick 0',
    );
    await user.selectOptions(screen.getByRole('combobox', { name: 'Line ending' }), 'No line ending');
    await user.type(screen.getByLabelText('Text to send'), 'x{Enter}');
    expect(worker.sent.at(-1)).toEqual({ type: 'serial', text: 'x' });

    // Wrong baud: garbled like real hardware, with a hint and a one-click fix (FR-SIM-07).
    await user.selectOptions(screen.getByRole('combobox', { name: 'Baud' }), '115200');
    expect(
      screen.getByText(/Your code sends at 9600 baud but the monitor is set to 115200/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Serial output')).not.toHaveTextContent('RoboSim ready');
    await user.click(screen.getByRole('button', { name: 'Switch to 9600' }));
    expect(screen.getByLabelText('Serial output')).toHaveTextContent('RoboSim ready');
    expect(screen.queryByText(/Your code sends at/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByLabelText('Serial output')).toHaveTextContent('Nothing received yet.');
  });

  it('replay: fetches the input log and reloads the scenario with it', async () => {
    const { worker, user } = await setup();
    worker.load({ ...benchScene, scenario: 'line-follower' });
    worker.frame(frame());
    await user.click(screen.getByRole('button', { name: 'Replay run' }));
    expect(worker.sent.at(-1)).toEqual({ type: 'exportLog' });
    const entries = [{ slice: 12, kind: 'serial' as const, text: 'x' }];
    worker.reply({
      type: 'inputLog',
      log: { ...logBase, scenario: 'line-follower', seed: 4, entries },
    });
    await vi.waitFor(() =>
      expect(worker.sent.slice(-2)).toEqual([
        { type: 'load', scenario: 'line-follower', seed: 4, inputLog: entries },
        { type: 'control', action: 'run' },
      ]),
    );
    worker.load({ ...benchScene, scenario: 'line-follower' }, 1);
    worker.frame(frame());
    expect(screen.getByRole('status')).toHaveTextContent('replaying 1 input');
  });

  it('replay of a project run reloads the project and firmware from the log', async () => {
    const { worker, user } = await setup();
    worker.load({ ...benchScene, scenario: 'line-follower' });
    worker.frame(frame());
    await user.click(screen.getByRole('button', { name: 'Replay run' }));
    worker.reply({ type: 'inputLog', log: { ...logBase, scenario: null, seed: 2, entries: [] } });
    await vi.waitFor(() =>
      expect(worker.sent.at(-2)).toEqual({
        type: 'load',
        project: logBase.project,
        firmware: logBase.firmware,
        seed: 2,
        inputLog: [],
      }),
    );
  });

  it('export: downloads the input log as JSON', async () => {
    const { worker, user } = await setup();
    worker.load({ ...benchScene, scenario: 'line-follower' });
    worker.frame(frame());
    const createObjectURL = vi.fn(() => 'blob:log');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await user.click(screen.getByRole('button', { name: 'Export input log' }));
    worker.reply({
      type: 'inputLog',
      log: { ...logBase, scenario: 'line-follower', seed: 1, entries: [] },
    });
    await vi.waitFor(() => expect(click).toHaveBeenCalled());
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('robosim-line-follower-seed1.json');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:log');
    click.mockRestore();
    vi.unstubAllGlobals();
  });

  it('verify: pauses, grades the run up to the same slice and compares it with the live run', async () => {
    const { worker, graders, user } = await setup();
    worker.load({ ...benchScene, scenario: 'line-follower' });
    worker.frame(frame());
    await user.click(screen.getByRole('button', { name: 'Verify run' }));
    expect(worker.sent.slice(-2)).toEqual([{ type: 'control', action: 'pause' }, { type: 'exportLog' }]);
    const log: InputLog = { ...logBase, scenario: 'line-follower', seed: 1, entries: [], endSlice: 1500 };
    worker.reply({ type: 'inputLog', log });
    await vi.waitFor(() => expect(graders[0]?.jobs).toEqual([{ log, maxSimSeconds: 1.5 }]));
    expect(screen.getByText('Grading…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verify run' })).toBeDisabled();

    const live = frame({ running: false });
    worker.frame(live);
    const result: VerifiedRun = {
      engineVersion: 'test',
      seed: 1,
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
    expect(screen.getByText('Simulated 1.50 s in 0.50 s (3.0× real time)')).toBeInTheDocument();
    expect(screen.getByTitle('ab'.repeat(32))).toHaveTextContent('abababababab');

    // One pin volt off → differs; running again → the comparison waits for a pause.
    worker.frame(
      frame({ running: false, pins: { ...live.pins, D2: { mode: 'input_pullup', level: 1, volts: 4.9 } } }),
    );
    expect(screen.getByText('Differs from your run at 1.50 s')).toBeInTheDocument();
    worker.frame(frame({ simTime: 2 }));
    expect(screen.getByText('Your run has moved on — pause it to compare')).toBeInTheDocument();
  });

  it('verify: shows grader errors and clears when the scenario changes', async () => {
    const { worker, graders, user } = await setup();
    worker.load({ ...benchScene, scenario: 'line-follower' });
    worker.frame(frame());
    await user.click(screen.getByRole('button', { name: 'Verify run' }));
    worker.reply({
      type: 'inputLog',
      log: { ...logBase, scenario: 'line-follower', seed: 1, entries: [], endSlice: 9 },
    });
    await vi.waitFor(() => expect(graders).toHaveLength(1));
    graders[0]?.reply({ type: 'error', message: 'Job needs engine x' });
    expect(screen.getByRole('alert')).toHaveTextContent('Verification failed: Job needs engine x');
    await user.click(screen.getByRole('radio', { name: 'Component bench' }));
    expect(screen.queryByText('Verified run')).not.toBeInTheDocument();
  });

  it('surfaces worker errors', async () => {
    const { worker } = await setup();
    worker.reply({ type: 'error', message: 'boom' });
    expect(screen.getByRole('alert')).toHaveTextContent('The simulation stopped: boom');
  });

  describe('sketch tab (build service)', () => {
    const original = [
      { name: 'sketch.ino', content: 'void setup() { pinMode(13, OUTPUT); }\nvoid loop() {}\n' },
    ];
    const edited = 'void setup() { pinMode(12, OUTPUT); }\nvoid loop() {}\n';
    const built: BuildResult = {
      buildId: 'b1',
      status: 'succeeded',
      cacheHit: false,
      artifact: {
        id: 'a'.repeat(64),
        format: 'ihex',
        sha256: 'a'.repeat(64),
        sizeBytes: 11,
        flashPct: 3,
        ramPct: 0.4,
        url: '/api/v1/artifacts/aaa',
      },
      diagnostics: [],
      durationMs: 420,
    };

    async function openSketch(compile: CompileSketch) {
      const t = await setup(compile);
      await t.user.click(screen.getByRole('radio', { name: 'Your code' }));
      expect(t.worker.sent).toContainEqual({ type: 'load', scenario: 'blink' });
      t.worker.load({ ...benchScene, scenario: 'blink', code: original });
      t.worker.frame(frame());
      return t;
    }

    it('edits the demo code, compiles it and runs the firmware on the same circuit', async () => {
      const compile = vi.fn<CompileSketch>().mockResolvedValue({ result: built, hex: ':00000001FF\n' });
      const { worker, user } = await openSketch(compile);
      const editor = screen.getByLabelText('Arduino code');
      expect(editor).toHaveValue(original[0]?.content);
      await user.clear(editor);
      await user.click(editor);
      await user.paste(edited);
      await user.click(screen.getByRole('button', { name: 'Compile & run' }));
      const files = [{ name: 'sketch.ino', content: edited }];
      expect(compile).toHaveBeenCalledWith(
        { board: 'avr-uno', files, libraries: [] },
        'en',
        expect.anything(),
      );
      await vi.waitFor(() =>
        expect(worker.sent.slice(-2)).toEqual([
          {
            type: 'load',
            template: 'blink',
            files,
            firmware: { format: 'ihex', text: ':00000001FF\n', sha256: 'a'.repeat(64) },
          },
          { type: 'control', action: 'run' },
        ]),
      );
      expect(screen.getByText(/Built: 3\.0% of flash, 0\.4% of RAM/)).toBeInTheDocument();
      worker.load({ ...benchScene, scenario: null, code: files });
      worker.frame(frame());
      expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled();
      // Back to the example: the edit is undone.
      await user.click(screen.getByRole('button', { name: 'Restore example' }));
      expect(screen.getByLabelText('Arduino code')).toHaveValue(original[0]?.content);
    });

    it('shows compiler errors on their line with a plain-language explanation, and does not run', async () => {
      const failed: BuildResult = {
        ...built,
        status: 'failed',
        artifact: undefined,
        diagnostics: [
          {
            file: 'sketch.ino',
            line: 2,
            column: 1,
            severity: 'error',
            message: "expected ';' before '}' token",
            explanationKey: 'missing_semicolon',
          },
        ],
      };
      const { worker, user } = await openSketch(vi.fn<CompileSketch>().mockResolvedValue({ result: failed }));
      const sent = worker.sent.length;
      await user.click(screen.getByRole('button', { name: 'Compile & run' }));
      const list = await screen.findByRole('list', { name: 'Compiler messages' });
      expect(within(list).getByText("expected ';' before '}' token")).toBeInTheDocument();
      expect(within(list).getByText('sketch.ino, line 2, column 1')).toBeInTheDocument();
      expect(
        within(list).getByText(/A ; is missing at the end of the previous statement/),
      ).toBeInTheDocument();
      expect(screen.getByText('1 error — fix it and compile again.')).toBeInTheDocument();
      expect(worker.sent.length).toBe(sent);
      // Clicking the message selects the line in the editor.
      await user.click(within(list).getByRole('button'));
      const editor = screen.getByLabelText<HTMLTextAreaElement>('Arduino code');
      expect(editor.value.slice(editor.selectionStart, editor.selectionEnd)).toBe('void loop() {}');
    });

    it('reports an unreachable build service', async () => {
      const { user } = await openSketch(vi.fn<CompileSketch>().mockRejectedValue(new Error('HTTP 502')));
      await user.click(screen.getByRole('button', { name: 'Compile & run' }));
      expect(await screen.findByText('The build service could not be reached: HTTP 502')).toBeInTheDocument();
    });
  });
});
