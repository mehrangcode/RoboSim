import { PITCH, addComponent, blankProject } from '@robosim/circuit-canvas';
import type { MeasureProbe, OhmsAnswer, ProbeReading } from '@robosim/sim-runtime/client';
import { BOARD_PART, type ProjectDocument } from '@robosim/shared';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { initI18n } from '../lib/i18n.js';
import { formatSi } from './format.js';
import { Multimeter } from './multimeter.js';
import { useMultimeter, type MultimeterSim } from './use-multimeter.js';

describe('formatSi (US-SIM-09 AC3)', () => {
  it.each([
    [0.0136, 'A', 13.6, 2, 'mA'],
    [2.5e-5, 'A', 25, 2, 'µA'],
    [1.5, 'A', 1.5, 3, 'A'],
    [0.42, 'V', 420, 1, 'mV'],
    [3.012, 'V', 3.012, 3, 'V'],
    [12.5, 'V', 12.5, 2, 'V'],
    [10_000, 'Ω', 10, 2, 'kΩ'],
    [4.7e6, 'Ω', 4.7, 3, 'MΩ'],
    [220, 'Ω', 220, 1, 'Ω'],
    [0.03, 'W', 30, 2, 'mW'],
    [-0.0136, 'A', -13.6, 2, 'mA'],
    [0, 'V', 0, 3, 'V'],
    [-0, 'A', 0, 3, 'A'],
    [-1e-12, 'A', 0, 3, 'µA'],
  ] as const)('%s %s → %s (%s decimals) %s', (value, unit, scaled, digits, symbol) => {
    const r = formatSi(value, unit);
    expect(r.scaled).toBeCloseTo(scaled, 9);
    if (scaled === 0) expect(Object.is(r.scaled, -0)).toBe(false);
    expect(r.digits).toBe(digits);
    expect(r.symbol).toBe(symbol);
  });
});

function project(): ProjectDocument {
  let doc = blankProject('t', '');
  doc = addComponent(doc, 'passive.resistor', [40 * PITCH, 4 * PITCH]).doc;
  return {
    ...doc,
    wires: [
      {
        id: 'w1',
        from: { part: BOARD_PART, pin: '5V' },
        to: { part: 'r1', pin: 'a' },
        color: 'red',
        points: [],
      },
    ],
  };
}

async function setup(
  lng: 'en' | 'fa',
  run: 'none' | 'paused' | 'running',
  readings: readonly ProbeReading[] | null,
  answer: OhmsAnswer = { type: 'ohms', id: 1, ohms: null, reason: 'open' },
) {
  const i18n = await initI18n(lng);
  const sim: MultimeterSim = {
    measure: vi.fn<(c: 'meter' | 'scope', p: readonly MeasureProbe[] | null) => void>(),
    ohms: vi.fn().mockResolvedValue(answer),
    meterReadings: readings,
  };
  const doc = project();
  function Harness() {
    const meter = useMultimeter({ doc, sim, active: true, run });
    return <Multimeter doc={doc} meter={meter} />;
  }
  render(
    <I18nextProvider i18n={i18n}>
      <Harness />
    </I18nextProvider>,
  );
  return { sim, user: userEvent.setup() };
}

const value = () => screen.getByTestId('meter-value').textContent;

describe('multimeter panel (FR-SIM-13)', () => {
  it('V mode: autoranged value with min/max once a probe is placed; subscribes the channel', async () => {
    const { sim, user } = await setup('en', 'running', [{ avg: 0.4204, min: 0.41, max: 0.43 }]);
    expect(screen.getByTestId('meter-hint')).toHaveTextContent('Place the red probe to start measuring.');
    await user.selectOptions(screen.getByLabelText('Red probe (+)'), 'r1 · a');
    expect(sim.measure).toHaveBeenLastCalledWith('meter', [
      { kind: 'v', red: { part: 'r1', pin: 'a' }, black: null },
    ]);
    await act(() => new Promise((r) => setTimeout(r, 150)));
    expect(value()).toBe('420.4 mV');
    expect(screen.getByTestId('meter-minmax').textContent).toBe(
      'min \u2066410.0 mV\u2069 · max \u2066430.0 mV\u2069',
    );
  });

  it('Ω: refused while running, OL when open, a value when stopped', async () => {
    const running = await setup('en', 'running', null);
    await running.user.click(screen.getByRole('radio', { name: /Resistance/ }));
    await running.user.selectOptions(screen.getByLabelText('Red probe (+)'), 'r1 · a');
    expect(screen.getByTestId('meter-hint')).toHaveTextContent('Stop the run to measure resistance');
    expect(running.sim.ohms).not.toHaveBeenCalled();
  });

  it('Ω on the edited circuit (no run): OL for an open pair', async () => {
    const { sim, user } = await setup('en', 'none', null);
    await user.click(screen.getByRole('radio', { name: /Resistance/ }));
    await user.selectOptions(screen.getByLabelText('Red probe (+)'), 'r1 · a');
    expect(sim.ohms).toHaveBeenCalledWith({ part: 'r1', pin: 'a' }, null, expect.anything());
    expect(await screen.findByText('OL')).toBeInTheDocument();
    expect(screen.getByTestId('meter-hint')).toHaveTextContent('Over range');
  });

  it('Ω value in Persian digits (FA)', async () => {
    const { user } = await setup('fa', 'paused', null, { type: 'ohms', id: 1, ohms: 9981 });
    await user.click(screen.getByRole('radio', { name: /مقاومت/ }));
    await user.selectOptions(screen.getByLabelText('پراب قرمز (+)'), 'r1 · a');
    expect(await screen.findByText('۹٫۹۸۱ kΩ')).toBeInTheDocument();
  });

  it('A mode: a wire in the cut set becomes an i probe; GND pins are refused with a reason', async () => {
    const { sim, user } = await setup('en', 'running', [{ avg: -0.0136, min: -0.0136, max: -0.0136 }]);
    await user.click(screen.getByRole('radio', { name: /Current/ }));
    await user.selectOptions(screen.getByLabelText('Current through'), 'Wire w1: board.5V → r1.a');
    expect(sim.measure).toHaveBeenLastCalledWith('meter', [
      { kind: 'i', pins: [{ part: BOARD_PART, pin: '5V' }], scale: -1 },
    ]);
    await act(() => new Promise((r) => setTimeout(r, 150)));
    expect(value()).toBe('-13.60 mA');
    expect(screen.getByText('Positive: current flows from board.5V to r1.a.')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Current through'), 'GND1');
    expect(screen.getByTestId('meter-hint')).toHaveTextContent('Current into GND is the sum');
  });

  it('no run: live modes say so; the readout has a polite live region', async () => {
    const { user } = await setup('en', 'none', null);
    await user.selectOptions(screen.getByLabelText('Red probe (+)'), 'r1 · b');
    expect(screen.getByTestId('meter-hint')).toHaveTextContent('Run the project to read live values.');
    expect(document.querySelector('[aria-live="polite"]')).not.toBeNull();
  });
});
