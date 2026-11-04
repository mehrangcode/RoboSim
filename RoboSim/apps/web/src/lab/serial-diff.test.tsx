import { SerialArchive } from '@robosim/sim-runtime/client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import { initI18n } from '../lib/i18n.js';
import { SerialDiffPanel } from './serial-diff.js';

const enc = new TextEncoder();
/** An archive of `[slice, text]` sends at `baud`. */
const archive = (sends: readonly (readonly [number, string])[], baud = 9600) => {
  const a = new SerialArchive();
  a.append(sends.map(([slice, text]) => ({ slice, baud, bytes: enc.encode(text) })));
  return a;
};

async function view(props: Partial<Parameters<typeof SerialDiffPanel>[0]>, lang: 'en' | 'fa' = 'en') {
  const i18n = await initI18n(lang);
  return render(
    <I18nextProvider i18n={i18n}>
      <SerialDiffPanel archive={archive([])} previous={null} verified={null} monitorBaud={9600} {...props} />
    </I18nextProvider>,
  );
}

describe('serial diff panel (FR-SIM-21, US-SIM-17)', () => {
  it('says two equal runs are identical', async () => {
    const run = [
      [0, 'hello\n'],
      [100, 'world\n'],
    ] as const;
    await view({ archive: archive(run), previous: archive(run), initial: { a: 'previous', b: 'live' } });
    expect(await screen.findByText('Identical: 2 lines, same text and times.')).toBeTruthy();
  });

  it('marks the first divergence with a label, not colour only, and jumps to it (AC2)', async () => {
    const lines = Array.from({ length: 40 }, (_, i) => [i * 10, `line ${i}\n`] as const);
    const changed = lines.map(([s, t], i) => (i === 30 ? ([s, 'line X\n'] as const) : ([s, t] as const)));
    await view({
      archive: archive(changed),
      previous: archive(lines),
      initial: { a: 'previous', b: 'live' },
    });

    expect(
      await screen.findByText('First divergence: line 31 (A) and line 31 (B) differ from column 6.'),
    ).toBeTruthy();
    const list = screen.getByRole('list', { name: 'Aligned lines' });
    const current = within(list)
      .getAllByRole('listitem')
      .find((r) => r.getAttribute('aria-current') === 'true');
    expect(current?.textContent).toContain('changed');
    expect(current?.textContent).toContain('line 30');
    expect(current?.textContent).toContain('line X');

    await userEvent.click(screen.getByRole('button', { name: 'Jump to first divergence' }));
    expect(document.activeElement).toBe(current);
  });

  it('reports a timing divergence and honours the tolerance', async () => {
    await view({
      archive: archive([
        [0, 'a\n'],
        [105, 'b\n'],
      ]),
      previous: archive([
        [0, 'a\n'],
        [100, 'b\n'],
      ]),
      initial: { a: 'previous', b: 'live' },
    });
    expect(
      await screen.findByText(
        'First divergence: line 2 (A) and line 2 (B) have the same text at different times.',
      ),
    ).toBeTruthy();
    const tol = screen.getByLabelText('Timing tolerance (ms)');
    await userEvent.clear(tol);
    await userEvent.type(tol, '10');
    expect(await screen.findByText('Identical: 2 lines, same text and times.')).toBeTruthy();
  });

  it('compares the live run with an imported log file', async () => {
    await view({
      archive: archive([
        [0, 'one\n'],
        [10, 'two\n'],
      ]),
      initial: { a: 'live', b: 'file' },
    });
    expect(screen.getByText('Choose a log file to compare.')).toBeTruthy();
    const file = new File(['one\nthree\n'], 'old.txt', { type: 'text/plain' });
    await userEvent.upload(screen.getByLabelText('Log file for B'), file);
    expect(
      await screen.findByText('First divergence: line 2 (A) and line 2 (B) differ from column 2.'),
    ).toBeTruthy();
    expect(screen.getByText(/old\.txt/)).toBeTruthy();
  });

  it('hints at the baud when a live run sent at another rate differs from the verified run', async () => {
    await view({
      archive: archive([[0, 'RoboSim ready\n']], 115200),
      verified: [{ slice: 0, text: 'RoboSim ready\n' }],
      initial: { a: 'live', b: 'verified' },
    });
    await waitFor(() => expect(screen.getByText(/^Baud differs/)).toBeTruthy());
  });

  it('keeps the log text LTR on a Persian page', async () => {
    const run = [[0, 'abc\n']] as const;
    await view(
      { archive: archive(run), previous: archive([[0, 'abd\n']]), initial: { a: 'previous', b: 'live' } },
      'fa',
    );
    const list = await screen.findByRole('list');
    for (const span of list.querySelectorAll('[data-side] > span[dir]'))
      expect(span.getAttribute('dir')).toBe('ltr');
  });
});
