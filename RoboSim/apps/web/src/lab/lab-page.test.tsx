import type { FindingView, Frame, MainToWorker, SceneInfo, WorkerToMain } from '@robosim/sim-runtime';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import { initI18n } from '../lib/i18n.js';
import { LabPage } from './lab-page.js';
import type { WorkerLike } from './use-simulation.js';

/** In-memory stand-in for the simulation worker: records commands, lets the test push replies. */
class FakeWorker implements WorkerLike {
  sent: MainToWorker[] = [];
  onmessage: ((event: MessageEvent<WorkerToMain>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage(message: MainToWorker): void {
    this.sent.push(message);
  }
  terminate(): void {}
  reply(msg: WorkerToMain): void {
    act(() => this.onmessage?.({ data: msg } as MessageEvent<WorkerToMain>));
  }
}

const benchScene: SceneInfo = {
  scenario: 'button',
  kind: 'bench',
  staticFindings: [],
  pins: ['D2', 'D13'],
  parts: [
    { id: 'led', type: 'actuator.led', inputs: [] },
    { id: 'btn', type: 'sensor.push-button', inputs: [{ name: 'pressed', type: 'boolean', default: false }] },
  ],
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

async function setup() {
  const i18n = await initI18n('en');
  const worker = new FakeWorker();
  render(
    <I18nextProvider i18n={i18n}>
      <LabPage createWorker={() => worker} />
    </I18nextProvider>,
  );
  return { worker, user: userEvent.setup() };
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
    worker.reply({
      type: 'loaded',
      scene: { ...benchScene, scenario: 'led-no-resistor', staticFindings: [ledFinding], parts: ledPart },
    });
    worker.reply({
      type: 'frame',
      frame: frame({ findings: [floating], damaged: { parts: ['led'], pins: ['D13'] } }),
    });

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

  it('loads and runs the line-follower arena by default', async () => {
    const { worker } = await setup();
    expect(worker.sent.slice(0, 2)).toEqual([
      { type: 'load', scenario: 'line-follower' },
      { type: 'control', action: 'run' },
    ]);
    expect(screen.getByRole('status')).toHaveTextContent('Loading the engine');
  });

  it('bench: shows parts and pins from the worker and sends button presses', async () => {
    const { worker, user } = await setup();
    await user.click(screen.getByRole('radio', { name: 'Component bench' }));
    await user.click(screen.getByRole('radio', { name: 'Button + LED' }));
    expect(worker.sent).toContainEqual({ type: 'load', scenario: 'button' });

    worker.reply({ type: 'loaded', scene: benchScene });
    worker.reply({ type: 'frame', frame: frame() });
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
    worker.reply({ type: 'loaded', scene: { ...benchScene, scenario: 'line-follower', kind: 'bench' } });
    worker.reply({ type: 'frame', frame: frame() });
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
    worker.reply({
      type: 'loaded',
      scene: { ...benchScene, scenario: 'line-follower', kind: 'bench', parts: [] },
    });
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
    worker.reply({ type: 'frame', frame: frame({ running: false, challenge }) });
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

  it('surfaces worker errors', async () => {
    const { worker } = await setup();
    worker.reply({ type: 'error', message: 'boom' });
    expect(screen.getByRole('alert')).toHaveTextContent('The simulation stopped: boom');
  });
});
