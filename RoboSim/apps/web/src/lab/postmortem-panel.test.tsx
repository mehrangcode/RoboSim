import type { PostMortem, PostMortemSeries } from '@robosim/sim-runtime/client';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { initI18n } from '../lib/i18n.js';
import { narrative, postMortemKey, rangeOf, traceColumns, victimTraces, windowOf } from './postmortem.js';
import { PostmortemPanel, PostmortemToast } from './postmortem-panel.js';

const fill = (n: number, v: number) => new Float32Array(n).fill(v);

/** D13 drives an LED without a resistor: 80 mA from 5 ms, damaged at 55 ms (as in led-no-resistor). */
function d13(over: Partial<PostMortem> = {}): PostMortem {
  const low = (key: string, quantity: 'V' | 'A', v: number): PostMortemSeries => ({
    key,
    label: { mcuPin: 'D13' },
    quantity,
    startSlice: 1,
    intervalSlices: 10,
    data: fill(5, v),
    peak: fill(5, v),
  });
  const high = (key: string, quantity: 'V' | 'A', v: number): PostMortemSeries => ({
    key,
    label: { mcuPin: 'D13' },
    quantity,
    startSlice: 6,
    intervalSlices: 1,
    data: fill(50, v),
  });
  return {
    record: {
      slice: 55,
      simTime: 0.055,
      componentIds: [],
      pins: ['D13'],
      reason: 'pin over-current',
      finding: {
        ruleId: 'SAF-PIN-CURRENT',
        severity: 'error',
        kind: 'runtime',
        componentIds: [],
        pinIds: ['D13'],
        messageKey: 'safety:SAF-PIN-CURRENT',
        params: { pin: 'D13', ma: 80, limit: 40 },
      },
      conditionKey: 'SAF-PIN-CURRENT:D13:e',
      conditionSince: 0.005,
      pc: 0x1a4,
    },
    series: [
      low('mcu:D13:V', 'V', 2.1),
      high('mcu:D13:V', 'V', 2.1),
      low('mcu:D13:A', 'A', -0.08),
      high('mcu:D13:A', 'A', -0.08),
    ],
    code: { serialLine: null, changedPins: [{ pin: 'D13', level: 1, msBefore: 50 }] },
    ...over,
  };
}

async function show(lng: 'en' | 'fa', records: readonly PostMortem[], props = {}) {
  const i18n = await initI18n(lng);
  const handlers = {
    onShow: vi.fn(),
    onFix: vi.fn(),
    onReplay: vi.fn(),
    onSelect: vi.fn(),
    onCancelReplay: vi.fn(),
  };
  render(
    <I18nextProvider i18n={i18n}>
      <PostmortemPanel
        records={records}
        partTypes={{ led: 'actuator.led' }}
        selected={null}
        fastForward={null}
        {...handlers}
        {...props}
      />
    </I18nextProvider>,
  );
  return { ...handlers, user: userEvent.setup() };
}

describe('post-mortem math (TD §18.8)', () => {
  it('groups series per key with their 100 Hz and 1 kHz parts', () => {
    const traces = victimTraces(d13());
    expect(traces.map((t) => [t.key, t.low?.intervalSlices, t.high?.intervalSlices])).toEqual([
      ['mcu:D13:V', 10, 1],
      ['mcu:D13:A', 10, 1],
    ]);
  });

  it('narrative numbers: since, damage time, peak magnitude, limit in A', () => {
    expect(narrative(d13())).toEqual({
      since: 0.005,
      at: 0.055,
      target: { mcuPin: 'D13' },
      peakA: expect.closeTo(0.08, 6),
      limitA: 0.04,
    });
  });

  it('columns use the 1 kHz segment where it exists and include the peak band', () => {
    const pm = d13();
    const [t0, t1] = windowOf(pm);
    const amps = victimTraces(pm).find((t) => t.quantity === 'A');
    if (!amps) throw new Error('no current trace');
    const col = traceColumns(amps, t0, t1, 100);
    const finite = Array.from(col.avg).filter(Number.isFinite);
    expect(finite.length).toBeGreaterThan(50);
    expect(finite.every((v) => Math.abs(v + 0.08) < 1e-6)).toBe(true);
    const [lo, hi] = rangeOf([col]);
    expect(lo).toBeLessThan(-0.08);
    expect(hi).toBeGreaterThanOrEqual(0);
  });

  it('a replayed damage keeps its identity', () => {
    expect(postMortemKey(d13())).toBe(postMortemKey(d13()));
  });
});

describe('PostmortemPanel (FR-SIM-16, US-SIM-12)', () => {
  it('EN: the narrative states when, how much, the limit and how long, in SI units', async () => {
    await show('en', [d13()]);
    const story = screen.getByText(/the current into pin D13 rose to/);
    expect(story.textContent).toMatch(/80\.00 mA/);
    expect(story.textContent).toMatch(/limit 40\.00 mA/);
    expect(story.textContent).toMatch(/50\.00 ms/);
    expect(story.textContent).toMatch(/55\.00 ms/);
    expect(screen.getByRole('img', { name: /Current at pin D13/ })).toBeInTheDocument();
  });

  it('FA: the same numbers with Persian digits', async () => {
    await show('fa', [d13()]);
    const story = screen.getByText(/جریان ورودی به پین D13/);
    expect(story.textContent).toContain('۸۰٫۰۰');
    expect(story.textContent).toContain('۴۰٫۰۰');
    expect(story.textContent).toContain('۵۰٫۰۰');
  });

  it('code: the line is unknown without the debugger; pins that changed are listed', async () => {
    await show('en', [d13()]);
    expect(screen.getByText(/Code line: unknown/)).toBeInTheDocument();
    expect(screen.getByText(/No serial output before the damage/)).toBeInTheDocument();
    expect(screen.getByText(/D13 → HIGH \(50\.0 ms before\)/)).toBeInTheDocument();
  });

  it('shows the last serial line when the firmware printed one', async () => {
    await show('en', [d13({ code: { serialLine: 'motor on', changedPins: [] } })]);
    expect(screen.getByText(/Last serial line: .*motor on/)).toBeInTheDocument();
    expect(screen.getByText(/No pin changed just before/)).toBeInTheDocument();
  });

  it('actions: show on circuit, fix, replay last 5 s', async () => {
    const pm = d13();
    const { user, onShow, onFix, onReplay } = await show('en', [pm]);
    await user.click(screen.getByRole('button', { name: 'Show on circuit' }));
    await user.click(screen.getByRole('button', { name: 'Fix' }));
    await user.click(screen.getByRole('button', { name: 'Replay last 5 s' }));
    expect(onShow).toHaveBeenCalledWith(pm);
    expect(onFix).toHaveBeenCalledWith(pm);
    expect(onReplay).toHaveBeenCalledWith(pm);
  });

  it('while fast-forwarding: progress with cancel, no replay button', async () => {
    const { user, onCancelReplay } = await show('en', [d13()], { fastForward: { done: 250, total: 1000 } });
    expect(screen.getByRole('status')).toHaveTextContent(/25%/);
    expect(screen.queryByRole('button', { name: /Replay/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancelReplay).toHaveBeenCalled();
  });

  it('several records: newest first, selectable; a part victim is named', async () => {
    const led = d13({
      record: {
        ...d13().record,
        componentIds: ['led'],
        pins: [],
        conditionKey: 'SAF-COMPONENT-FAULT:led:OVER_CURRENT',
        finding: null,
      },
      series: [],
    });
    await show('en', [d13(), led]);
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options[0]).toMatch(/^LED damaged at/);
    expect(options[1]).toMatch(/pin D13/);
    expect(screen.getByText(/The problem started at/)).toBeInTheDocument();
  });
});

describe('PostmortemToast', () => {
  it('is announced assertively and opens or dismisses', async () => {
    const i18n = await initI18n('en');
    const onOpen = vi.fn();
    const onDismiss = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <PostmortemToast record={d13()} partTypes={{}} onOpen={onOpen} onDismiss={onDismiss} />
      </I18nextProvider>,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveTextContent('Part damaged: what happened?');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'What happened?' }));
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onOpen).toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalled();
  });
});
