import { PITCH, addComponent, blankProject } from '@robosim/circuit-canvas';
import { ScopeBuffer, type MeasureProbe } from '@robosim/sim-runtime/client';
import { BOARD_PART, type ProjectDocument } from '@robosim/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { i18n as I18n } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../lib/i18n.js';
import { Multimeter } from './multimeter.js';
import { Oscilloscope } from './oscilloscope.js';
import { useMultimeter, type MultimeterSim } from './use-multimeter.js';
import { SCOPE_SETTINGS_KEY, useScope, type ScopeSettings } from './use-scope.js';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

function project(): ProjectDocument {
  let doc = blankProject('Scope', '');
  doc = addComponent(doc, 'passive.resistor', [40 * PITCH, 4 * PITCH]).doc;
  return doc;
}

const D5: MeasureProbe = { kind: 'v', red: { part: BOARD_PART, pin: 'D5' }, black: null };

/** A 10 Hz square (0 / 5 V) on one channel, slices `from` … `from + n − 1`. */
function square(buf: ScopeBuffer, from: number, n: number) {
  const data = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) data.fill(Math.floor((from + k) / 50) % 2 ? 0 : 5, 3 * k, 3 * k + 3);
  buf.append(from, n, data);
}

function store(s: Partial<ScopeSettings>) {
  localStorage.setItem(
    SCOPE_SETTINGS_KEY,
    JSON.stringify({
      timebase: 0.02,
      trigger: { ch: 0, edge: 'rising', level: 2.5, mode: 'auto', holdoffS: 0 },
      ...s,
    }),
  );
}

async function setup(
  lng: 'en' | 'fa',
  buffer: ScopeBuffer | null,
  run: 'none' | 'paused' | 'running' = 'running',
) {
  const i18n: I18n = await initI18n(lng);
  const measure = vi.fn<(c: 'meter' | 'scope', p: readonly MeasureProbe[] | null) => void>();
  const scopeFine = vi.fn<(on: boolean) => void>();
  const doc = project();
  function Harness({ version, rtf }: { version: number; rtf: number }) {
    const scope = useScope({
      doc,
      sim: {
        measure,
        scopeFine,
        frame: { running: run === 'running', rtf },
        scope: buffer,
        scopeVersion: version,
      },
      active: true,
    });
    return <Oscilloscope doc={doc} scope={scope} run={run} />;
  }
  const view = render(
    <I18nextProvider i18n={i18n}>
      <Harness version={0} rtf={1} />
    </I18nextProvider>,
  );
  const update = (version: number, rtf = 1) =>
    view.rerender(
      <I18nextProvider i18n={i18n}>
        <Harness version={version} rtf={rtf} />
      </I18nextProvider>,
    );
  return { measure, scopeFine, update, user: userEvent.setup() };
}

const chartLabel = () => screen.getByRole('img').getAttribute('aria-label');

describe('oscilloscope panel (FR-SIM-14, US-SIM-10)', () => {
  it('adds a voltage channel from the point list; subscribes and remembers it', async () => {
    const { measure, user } = await setup('en', null, 'none');
    expect(screen.getByText(/Add a channel/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Add a voltage channel (to GND)'), 'r1 · a');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(measure).toHaveBeenLastCalledWith('scope', [
      { kind: 'v', red: { part: 'r1', pin: 'a' }, black: null },
    ]);
    expect(screen.getByTestId('scope-ch1')).toHaveTextContent('CH1r1.a');
    expect(JSON.parse(localStorage.getItem(SCOPE_SETTINGS_KEY) ?? '{}').channels).toHaveLength(1);
    expect(screen.getByText('Run the project to see the traces.')).toBeInTheDocument();
  });

  it('single: arms once, triggers and freezes while new samples arrive', async () => {
    store({
      channels: [{ probe: D5, scale: 1, offset: 0 }],
      trigger: { ch: 0, edge: 'rising', level: 2.5, mode: 'single', holdoffS: 0 },
    });
    const buf = new ScopeBuffer(1);
    square(buf, 0, 400);
    const { update, user } = await setup('en', buf);
    await user.click(screen.getByRole('button', { name: 'Arm' }));
    square(buf, 400, 300);
    update(1);
    expect(screen.getByTestId('scope-status')).toHaveTextContent('Triggered');
    const frozen = chartLabel();
    square(buf, 700, 500);
    update(2);
    expect(screen.getByTestId('scope-status')).toHaveTextContent('Triggered');
    expect(chartLabel()).toBe(frozen);
  });

  it('auto free-runs without a trigger crossing; normal waits', async () => {
    store({
      channels: [{ probe: D5, scale: 1, offset: 0 }],
      trigger: { ch: 0, edge: 'rising', level: 9, mode: 'auto', holdoffS: 0 },
    });
    const buf = new ScopeBuffer(1);
    square(buf, 0, 400);
    const { user } = await setup('en', buf);
    expect(screen.getByTestId('scope-status')).toHaveTextContent('Auto: free-running');
    await user.click(screen.getByRole('radio', { name: 'Normal' }));
    expect(screen.getByTestId('scope-status')).toHaveTextContent('Waiting for a trigger');
  });

  it('exports CSV with time in ms and each channel in its unit', async () => {
    store({
      channels: [
        { probe: D5, scale: 1, offset: 0 },
        { probe: { kind: 'i', pins: [{ part: 'r1', pin: 'a' }], scale: 1 }, scale: 0.01, offset: 0 },
      ],
    });
    const buf = new ScopeBuffer(2);
    const data = new Float32Array(300 * 6);
    for (let k = 0; k < 300; k++) data.set([5, 0, 5, 0.012, 0.012, 0.012], 6 * k);
    buf.append(100, 300, data);
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob) => (blobs.push(b), 'blob:x'));
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { user } = await setup('en', buf);
    await user.click(screen.getByRole('button', { name: 'Export CSV (whole buffer)' }));
    const lines =
      (await blobs[0]?.text())
        ?.replace(/^\uFEFF/, '')
        .trim()
        .split('\r\n') ?? [];
    expect(lines[0]).toBe('time_ms,ch1_avg_V,ch1_min_V,ch1_max_V,ch2_avg_A,ch2_min_A,ch2_max_A');
    expect(lines).toHaveLength(301);
    expect(lines[1]).toBe('100,5,0,5,0.012,0.012,0.012');
    await user.click(screen.getByRole('button', { name: 'Export CSV (screen)' }));
    const screenLines = (await blobs[1]?.text())?.trim().split('\r\n') ?? [];
    expect(screenLines.length).toBeLessThan(lines.length); // 200 ms on screen
  });

  it('cursor measurements: Δt, frequency, min/max/average/RMS per channel', async () => {
    store({ channels: [{ probe: D5, scale: 1, offset: 0 }], timebase: 0.05 });
    const buf = new ScopeBuffer(1);
    square(buf, 0, 1000);
    await setup('en', buf, 'paused');
    const table = screen.getByTestId('scope-measurements');
    expect(within(table).getByText('Over the screen')).toBeInTheDocument();
    const row = within(table).getAllByRole('row')[1];
    expect(row).toHaveTextContent('5.000 V'); // max
    expect(row).toHaveTextContent(/10\.00 Hz/);
  });

  it('a channel whose part is gone shows "—"', async () => {
    store({ channels: [{ probe: { kind: 'p', part: 'ghost' }, scale: 0.1, offset: 0 }] });
    await setup('en', new ScopeBuffer(1));
    expect(screen.getByTestId('scope-ch1')).toHaveTextContent('—');
  });

  it('Persian: RTL panel, plot and numbers stay LTR, channel styles differ by more than colour', async () => {
    store({
      channels: [
        { probe: D5, scale: 1, offset: 0 },
        { probe: { ...D5, red: { part: BOARD_PART, pin: 'D6' } }, scale: 1, offset: 0 },
      ],
    });
    const buf = new ScopeBuffer(2);
    const data = new Float32Array(300 * 6).fill(5);
    buf.append(0, 300, data);
    await setup('fa', buf);
    expect(screen.getByRole('region', { name: 'اسیلوسکوپ' })).toBeInTheDocument();
    expect(screen.getByRole('img').closest('[dir]')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText('در A')).toBeInTheDocument();
    const cells = screen.getByTestId('scope-measurements').querySelectorAll('bdi.ltr');
    expect(cells.length).toBeGreaterThan(0);
    expect(cells[0]?.textContent).toMatch(/[۰-۹]/); // Persian digits, isolated LTR
    const dash = (n: number) =>
      screen.getByTestId(`scope-ch${n}`).querySelector('line')?.getAttribute('stroke-dasharray');
    expect(dash(1)).toBeNull();
    expect(dash(2)).toBe('6 3');
  });

  it('caps at 4 channels', async () => {
    store({
      channels: ['D2', 'D3', 'D5', 'D6'].map((pin) => ({
        probe: { ...D5, red: { part: BOARD_PART, pin } },
        scale: 1,
        offset: 0,
      })),
    });
    await setup('en', null);
    expect(screen.getByText(/All 4 channels are in use/)).toBeInTheDocument();
  });
});

describe('meter → scope (TD §18.3 "Add to scope")', () => {
  it('adds the meter probe as a channel', async () => {
    const i18n = await initI18n('en');
    const sim: MultimeterSim = { measure: vi.fn(), ohms: vi.fn(), meterReadings: null };
    const add = vi.fn<(p: MeasureProbe) => void>();
    const doc = project();
    function Harness() {
      const meter = useMultimeter({ doc, sim, active: true, run: 'running' });
      return <Multimeter doc={doc} meter={meter} onAddToScope={add} />;
    }
    render(
      <I18nextProvider i18n={i18n}>
        <Harness />
      </I18nextProvider>,
    );
    const user = userEvent.setup();
    expect(screen.getByRole('button', { name: 'Add to scope' })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('Red probe (+)'), 'r1 · a');
    await user.click(screen.getByRole('button', { name: 'Add to scope' }));
    expect(add).toHaveBeenCalledWith({ kind: 'v', red: { part: 'r1', pin: 'a' }, black: null });
  });
});

describe('oscilloscope fine mode (TD §18.3 phase 2)', () => {
  const fineScope = () => store({ channels: [{ probe: D5, scale: 1, offset: 0 }], timebase: 0.0005 });

  it('below 1 ms/div on a voltage channel: asks the worker for sub-steps and says so', async () => {
    fineScope();
    const buf = new ScopeBuffer(1);
    square(buf, 0, 200);
    buf.appendFine(true, Float64Array.from([0, 0.1995, 2.5]));
    const { scopeFine, user } = await setup('en', buf);
    expect(scopeFine).toHaveBeenLastCalledWith(true);
    expect(screen.getByTestId('scope-fine')).toHaveTextContent(/Fine mode: between the 1 kHz readings/);
    await user.selectOptions(screen.getByLabelText('Timebase'), String(0.001));
    expect(scopeFine).toHaveBeenLastCalledWith(false);
    expect(screen.queryByTestId('scope-fine')).toBeNull();
  });

  it('a circuit without sub-steps: tells the user there is nothing finer', async () => {
    fineScope();
    const buf = new ScopeBuffer(1);
    square(buf, 0, 200);
    buf.appendFine(false, new Float64Array(0));
    await setup('fa', buf);
    expect(screen.getByTestId('scope-fine')).toHaveTextContent(/خازن یا سلف ندارد/);
  });

  it('turns itself off when the run stays below 0.8× the speed for 2 s; can be turned on again', async () => {
    fineScope();
    const buf = new ScopeBuffer(1);
    square(buf, 0, 200);
    const clock = vi.spyOn(performance, 'now');
    try {
      clock.mockReturnValue(1000);
      const { scopeFine, update, user } = await setup('en', buf);
      update(1, 0.5);
      clock.mockReturnValue(2500);
      update(2, 0.7);
      expect(scopeFine).toHaveBeenLastCalledWith(true); // 1.5 s: not yet
      clock.mockReturnValue(3100);
      update(3, 0.6);
      expect(scopeFine).toHaveBeenLastCalledWith(false);
      expect(screen.getByTestId('scope-fine')).toHaveTextContent(/Fine mode was turned off/);
      update(4, 1);
      await user.click(screen.getByRole('button', { name: 'Turn fine mode on again' }));
      expect(scopeFine).toHaveBeenLastCalledWith(true);
    } finally {
      clock.mockRestore();
    }
  });
});
