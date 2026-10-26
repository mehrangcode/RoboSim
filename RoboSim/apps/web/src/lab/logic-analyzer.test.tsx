import { PinCapture } from '@robosim/sim-runtime/client';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { initI18n } from '../lib/i18n.js';
import { LogicAnalyzer } from './logic-analyzer.js';

/** 100 ms of D9 at 1 kHz with 25 % duty (high 250 µs) and D10 idle, on a 16 MHz clock. */
function capture(): PinCapture {
  const c = new PinCapture(1, { pins: ['D9', 'D10'], cycle: 0, clockHz: 16e6, levels: [0, 0] });
  const data: number[] = [];
  for (let k = 0; k < 100; k++) data.push(0, 1, 1000 + k * 16_000, 0, 0, 5000 + k * 16_000);
  c.append(Float64Array.from(data), 1_600_000, false);
  return c;
}

describe('logic analyzer view (FR-SIM-08)', () => {
  it('records the chosen pins and stops', async () => {
    const i18n = await initI18n('en');
    const probe = vi.fn();
    const view = (probing: readonly string[] | null) => (
      <I18nextProvider i18n={i18n}>
        <LogicAnalyzer
          pins={['D9', 'D10', 'D13']}
          capture={null}
          probing={probing}
          probe={probe}
          onClear={vi.fn()}
        />
      </I18nextProvider>
    );
    localStorage.removeItem('robosim.analyzer.v1');
    const { rerender } = render(view(null));
    await userEvent.click(screen.getByRole('checkbox', { name: 'D13' }));
    await userEvent.click(screen.getByRole('button', { name: 'Record' }));
    expect(probe).toHaveBeenLastCalledWith(['D9', 'D10']);
    rerender(view(['D9', 'D10']));
    expect(screen.getByText(/Recording/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(probe).toHaveBeenLastCalledWith(null);
  });

  it('shows both signals; cursors snap to edges and measure the pulse to the microsecond (US-SIM-02 AC2)', async () => {
    const i18n = await initI18n('en');
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <LogicAnalyzer
          pins={['D9', 'D10']}
          capture={capture()}
          probing={null}
          probe={vi.fn()}
          onClear={vi.fn()}
        />
      </I18nextProvider>,
    );
    expect([...container.querySelectorAll('path[data-pin]')].map((p) => p.getAttribute('data-pin'))).toEqual([
      'D9',
      'D10',
    ]);
    expect(screen.getByRole('status').textContent).toBe('100.0 ms recorded · 200 edges');

    const diagram = screen.getByRole('img');
    await userEvent.click(screen.getByRole('button', { name: 'Fit' }));
    diagram.focus();
    await userEvent.keyboard('{ArrowRight}'); // A → first rising edge (62.5 µs)
    await userEvent.keyboard('{Shift>}{ArrowRight}{ArrowRight}{/Shift}'); // B → first falling edge
    expect(screen.getByTestId('analyzer-delta').textContent).toBe('B − A = 250.0 µs (4.000 kHz)');

    const row = within(screen.getByRole('table')).getByText('D9').closest('tr') as HTMLTableRowElement;
    expect([...row.querySelectorAll('td')].map((td) => td.textContent)).toEqual([
      'D9',
      'HIGH',
      '250.0 µs',
      '1.000 ms',
      '1.000 kHz',
      '25.0 %',
    ]);
  });
});
