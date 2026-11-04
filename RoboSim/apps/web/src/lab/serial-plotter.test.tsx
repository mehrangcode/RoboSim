import { SerialArchive, SerialLog } from '@robosim/sim-runtime/client';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { initI18n } from '../lib/i18n.js';
import { SerialMonitor } from './serial-monitor.js';
import { SerialPlotter } from './serial-plotter.js';

const lines = (texts: string[]) => texts.map((text, i) => ({ slice: i * 10, text, baud: 9600 }));

describe('serial plotter view (FR-SIM-07)', () => {
  it('draws one line per column with a legend carrying the latest values (US-SIM-03 AC2)', async () => {
    const i18n = await initI18n('en');
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <SerialPlotter lines={lines(['1,10', '2,20', '3,30'])} partial={false} />
      </I18nextProvider>,
    );
    expect(
      [...container.querySelectorAll('path[data-series]')].map((p) => p.getAttribute('data-series')),
    ).toEqual(['#1', '#2']);
    const legend = screen.getByRole('list', { name: 'Series' });
    expect(
      within(legend)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Value 13', 'Value 230']);
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      'Plot of 2 series over the last 3 samples',
    );

    // Hiding a series removes its line; its colour slot stays with it.
    await userEvent.click(within(legend).getAllByRole('button')[0] as HTMLElement);
    expect([...container.querySelectorAll('path[data-series]')].map((p) => p.getAttribute('stroke'))).toEqual(
      ['var(--color-series-2)'],
    );
  });

  it('pauses on the current samples', async () => {
    const i18n = await initI18n('en');
    const view = (texts: string[]) => (
      <I18nextProvider i18n={i18n}>
        <SerialPlotter lines={lines(texts)} partial={false} />
      </I18nextProvider>
    );
    const { rerender } = render(view(['a:1']));
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
    rerender(view(['a:1', 'a:2', 'a:3']));
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('last 1 samples');
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('last 3 samples');
  });

  it('is a view of the serial monitor, switched with the Monitor / Plotter control', async () => {
    const i18n = await initI18n('fa');
    const log = new SerialLog();
    log.append([{ slice: 0, baud: 9600, bytes: new TextEncoder().encode('5,6\n') }]);
    render(
      <I18nextProvider i18n={i18n}>
        <SerialMonitor log={log} send={() => undefined} />
      </I18nextProvider>,
    );
    expect(screen.getByLabelText('خروجی سریال').textContent).toBe('5,6');
    await userEvent.click(screen.getByRole('radio', { name: 'نمودار' }));
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('نمودار ۲ سری در ۱ نمونهٔ آخر');
  });
  it('exports the whole run, not only what Clear left in view, and opens Compare (FR-SIM-21 AC1)', async () => {
    const i18n = await initI18n('en');
    const chunk = { slice: 1000, baud: 9600, bytes: new TextEncoder().encode('a,"b"\n') };
    const log = new SerialLog();
    const archive = new SerialArchive();
    archive.append([chunk]);
    const onCompare = vi.fn();
    const blobs: Blob[] = [];
    const names: string[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => (blobs.push(b as Blob), 'blob:x'));
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(this.download);
    });
    render(
      <I18nextProvider i18n={i18n}>
        <SerialMonitor
          log={log}
          archive={archive}
          fileBase="robot"
          send={() => undefined}
          onCompare={onCompare}
        />
      </I18nextProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: /Export/ }));
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual([
      'Text (.txt)',
      'Text with times (.txt)',
      'CSV (.csv)',
    ]);
    await userEvent.click(screen.getByRole('menuitem', { name: 'CSV (.csv)' }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(names[0]).toMatch(/^robot-serial-.*\.csv$/);
    expect(await blobs[0]?.text()).toContain('"a,""b"""');
    await userEvent.click(screen.getByRole('button', { name: 'Compare…' }));
    expect(onCompare).toHaveBeenCalledOnce();
    click.mockRestore();
    vi.restoreAllMocks();
  });
});
