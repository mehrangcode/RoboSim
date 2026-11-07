import { createI18n } from '@robosim/i18n';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { i18n as I18n } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { blankProject } from './document.js';
import { LibraryPanel } from './library-panel.js';
import { useCircuitEditor } from './use-circuit-editor.js';

let i18n: I18n;
beforeAll(async () => {
  i18n = await createI18n({ lng: 'en', plugins: [initReactI18next] });
});

function setup(props: Omit<Parameters<typeof LibraryPanel>[0], 'editor'> = {}) {
  function Harness() {
    const editor = useCircuitEditor(blankProject('Test', ''));
    return <LibraryPanel editor={editor} {...props} />;
  }
  render(
    <I18nextProvider i18n={i18n}>
      <Harness />
    </I18nextProvider>,
  );
  return { user: userEvent.setup(), list: screen.getByRole('list', { name: 'Components' }) };
}

/** The result row (li) of a part, found by its add button. */
const row = (list: HTMLElement, name: string) =>
  within(list)
    .getByRole('button', { name: new RegExp(`^Add ${name}( \\(Pro part\\))?$`) })
    .closest('li') as HTMLElement;

describe('library search by function (FR-CIR-12)', () => {
  it('"measure distance" puts HC-SR04 first with a why line and chips; unpriced shows "—"', async () => {
    const { user, list } = setup({ priceOf: (type) => (type === 'sensor.vl53l0x' ? 1_200_000 : null) });
    await user.type(screen.getByRole('searchbox'), 'measure distance');
    const adds = within(list).getAllByRole('button', { name: /^Add / });
    expect(adds[0]).toHaveAccessibleName('Add HC-SR04 ultrasonic sensor');
    const first = row(list, 'HC-SR04 ultrasonic sensor');
    expect(first).toHaveTextContent('Why: Measure distance — Reports how far the nearest object is.');
    expect(first).toHaveTextContent('4.5–5.5 V');
    expect(first).toHaveTextContent('Pulse');
    expect(first).toHaveTextContent('Price —');
    expect(within(list).getByText('1,200,000')).toBeInTheDocument();
  });

  it('a per-part why text replaces the generic one', async () => {
    const { user, list } = setup();
    await user.type(screen.getByRole('searchbox'), 'make 5v');
    expect(row(list, 'LM2596 buck converter')).toHaveTextContent('Adjustable: set its output to 5 V.');
  });

  it('compares up to three parts side by side', async () => {
    const { user } = setup({ priceOf: () => 500_000, formatPrice: (irr) => `${irr / 10} T` });
    await user.type(screen.getByRole('searchbox'), 'drive two motors');
    const ticks = screen.getAllByRole('checkbox', { name: /^Compare / });
    for (const box of ticks.slice(0, 3)) await user.click(box);
    expect(ticks[3]).toBeDisabled();
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader')).toHaveLength(4);
    expect(within(table).getAllByText('50000 T')).toHaveLength(3);
    expect(screen.getByRole('heading', { name: 'Compare (3/3)' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(ticks[3]).toBeEnabled();
  });

  it('offers Ask AI only for weak results and only when AI is usable', async () => {
    const onAskAi = vi.fn();
    const { user } = setup({ onAskAi });
    const box = screen.getByRole('searchbox');
    await user.type(box, 'measure distance');
    expect(screen.queryByRole('button', { name: /Ask AI/ })).not.toBeInTheDocument();
    await user.clear(box);
    await user.type(box, 'teleport the cat');
    await user.click(screen.getByRole('button', { name: /Ask AI/ }));
    expect(onAskAi).toHaveBeenCalledWith('teleport the cat');
  });

  it('shows no Ask AI without the callback (no AI entitlement)', async () => {
    const { user } = setup();
    await user.type(screen.getByRole('searchbox'), 'teleport the cat');
    expect(screen.getByText('No part matches.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ask AI/ })).not.toBeInTheDocument();
  });

  it("voltage chips: rated maximum, a battery's nominal output, an LED's forward voltage", async () => {
    const { user, list } = setup();
    const box = screen.getByRole('searchbox');
    await user.type(box, 'transistor switch');
    expect(row(list, '2N2222 NPN transistor')).toHaveTextContent('≤ 40 V');
    await user.clear(box);
    await user.type(box, 'battery');
    expect(row(list, '9 V battery')).toHaveTextContent(/(^|\s)9 V/);
    await user.clear(box);
    await user.type(box, 'status light');
    expect(row(list, 'LED')).toHaveTextContent('Vf 2 V');
  });

  it('the plain list (no query) has no chips or compare boxes', () => {
    setup();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});
