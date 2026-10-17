import type { Frame, SceneInfo } from '@robosim/sim-runtime/client';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import { initI18n } from '../lib/i18n.js';
import { PinTable } from './pin-table.js';

const scene = { pins: ['D5', 'A0'] } as unknown as SceneInfo;
const frame = {
  pins: {
    A0: { mode: 'input', level: 0, volts: 1.23 },
    D2: { mode: 'input', level: 0, volts: 0, unwired: true, floating: true },
    D5: { mode: 'output', level: 1, volts: 1.25, duty: 0.25, freqHz: 976.5625 },
    D13: { mode: 'output', level: 1, volts: 5, unwired: true },
  },
  damaged: { parts: [], pins: [] },
} as unknown as Frame;

describe('pin inspector (FR-SIM-06)', () => {
  it('shows every pin in header order with PWM duty and frequency; unconnected pins can be hidden', async () => {
    const i18n = await initI18n('en');
    render(
      <I18nextProvider i18n={i18n}>
        <PinTable scene={scene} frame={frame} />
      </I18nextProvider>,
    );
    const rows = () => screen.getAllByRole('row').slice(1);
    expect(rows().map((r) => within(r).getAllByRole('cell')[0]?.textContent)).toEqual([
      'D2',
      'D5',
      'D13',
      'A0',
    ]);
    // US-SIM-02 AC1: analogWrite(5, 64) → PWM 25 % at ~980 Hz.
    expect(rows()[1]).toHaveTextContent('PWM 25% · 977 Hz');
    expect(rows()[0]).toHaveTextContent('floating');
    expect(rows()[2]).toHaveTextContent('not connected');
    expect(rows()[3]).toHaveTextContent('1.23 V');
    expect(rows()[3]).toHaveTextContent('ADC 251'); // analogRead(A0) at 1.23 V
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show unconnected pins' }));
    expect(rows().map((r) => within(r).getAllByRole('cell')[0]?.textContent)).toEqual(['D5', 'A0']);
  });
});
