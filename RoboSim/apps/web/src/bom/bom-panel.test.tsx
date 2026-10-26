import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { starterProject } from '../editor/starter.js';
import { EditorPage } from '../editor/editor-page.js';
import { AuthContext } from '../auth/use-auth.js';
import { FakeAuth, SARA } from '../testing/fake-auth.js';
import { BomPanel } from './bom-panel.js';
import { initI18n } from '../lib/i18n.js';
import { FakeBom } from '../testing/fake-bom.js';
import { FakeWorker } from '../testing/fake-worker.js';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useParams: () => ({}),
  useNavigate: () => vi.fn(),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

/** The editor on its starter project: Uno, half breadboard, 220 Ω + red LED, three jumpers. */
async function setup(locale: 'en' | 'fa' = 'en') {
  const i18n = await initI18n(locale);
  const bom = new FakeBom();
  render(
    <I18nextProvider i18n={i18n}>
      <EditorPage createWorker={() => new FakeWorker()} bom={bom} />
    </I18nextProvider>,
  );
  return { bom, user: userEvent.setup() };
}

describe('parts list (FR-BOM-01…03)', () => {
  it('lists the parts with prices, totals and jumpers, and remembers owned parts for a guest', async () => {
    const { user } = await setup();
    await user.click(screen.getByRole('radio', { name: 'Parts list' }));
    const table = await screen.findByRole('table', { name: 'Parts to build this circuit' });
    const row = (name: string) => within(table).getByText(name).closest('tr') as HTMLElement;

    expect(within(row('Arduino Uno R3')).getAllByText('9,500,000 rials')).toHaveLength(2);
    // The LED takes the price set for every LED colour.
    expect(within(row('LED — Red')).getAllByText('20,000 rials')).toHaveLength(2);
    expect(row('Resistor — 220 Ω')).toBeInTheDocument();
    expect(row('Jumper wires, male–male (pack of 10)')).toHaveTextContent(
      '3 wires in the circuit, with spares',
    );
    expect(screen.getByTestId('bom-total')).toHaveTextContent('9,520,000 rials');
    expect(screen.getByText('3 parts have no price yet, so the total leaves them out.')).toBeInTheDocument();
    expect(screen.getByText('Prices as of Oct 21, 2026', { exact: false })).toBeInTheDocument();

    const owned = screen.getByLabelText('How many Arduino Uno R3 you already own');
    await user.clear(owned);
    await user.type(owned, '1');
    expect(screen.getByTestId('bom-total')).toHaveTextContent('20,000 rials');
    expect(JSON.parse(localStorage.getItem('robosim.inventory.v1') ?? '{}')).toEqual({ 'board:avr-uno': 1 });
  });
});

describe('wiring guide (FR-BOM-04)', () => {
  it('lists every connection by subsystem with a diagram and points the canvas at a wire', async () => {
    const { user } = await setup();
    await user.click(screen.getByRole('radio', { name: 'Wiring' }));
    const monitor = screen.getByRole('region', { name: 'Monitor' });
    const steps = await within(monitor).findAllByRole('listitem');
    const texts = steps.map((s) => s.querySelector('p')?.textContent ?? '');
    // Two parts plugged in and three wires.
    expect(texts).toHaveLength(5);
    expect(
      texts.some((t) =>
        t.includes('Connect Arduino Uno R3 D13 to hole 10e on the Half breadboard (to Resistor A)'),
      ),
    ).toBe(true);
    expect(texts.some((t) => t.includes('Plug the LED into the Half breadboard'))).toBe(true);
    expect(within(monitor).getAllByRole('img', { name: /^Diagram: / })).toHaveLength(5);

    const d13 = steps.find((s) => s.querySelector('p')?.textContent?.includes('R3 D13 to')) as HTMLElement;
    expect(within(d13).getByText('Yellow wire, male–male jumper')).toBeInTheDocument();
    await user.click(within(d13).getByRole('button', { name: 'Show on canvas' }));
    expect(await screen.findByText(/^Wire w\d+$/)).toBeInTheDocument();
  });

  it('reads in Persian', async () => {
    const { user } = await setup('fa');
    await user.click(screen.getByRole('radio', { name: 'سیم‌کشی' }));
    expect(await screen.findByRole('heading', { name: 'تغذیه' })).toBeInTheDocument();
  });
});

describe('owned parts of a signed-in user (FR-BOM-03)', () => {
  it('moves the guest’s marks into the account on sign-in and saves changes there', async () => {
    localStorage.setItem(
      'robosim.inventory.v1',
      JSON.stringify({ 'board:avr-uno': 1, 'actuator.led?color=red': 1 }),
    );
    const i18n = await initI18n('en');
    const bom = new FakeBom();
    bom.owned = { items: [{ partKey: 'actuator.led?color=red', quantity: 2 }] };
    render(
      <I18nextProvider i18n={i18n}>
        <AuthContext value={{ me: SARA, client: new FakeAuth(), setMe: () => undefined }}>
          <BomPanel doc={starterProject('Blink')} tab="parts" client={bom} onShow={() => undefined} />
        </AuthContext>
      </I18nextProvider>,
    );
    const uno = await screen.findByLabelText<HTMLInputElement>('How many Arduino Uno R3 you already own');
    await vi.waitFor(() => expect(uno.value).toBe('1'));
    expect(bom.saved[0]?.items).toEqual([
      { partKey: 'actuator.led?color=red', quantity: 2 },
      { partKey: 'board:avr-uno', quantity: 1 },
    ]);
    expect(localStorage.getItem('robosim.inventory.v1')).toBeNull();

    await userEvent.clear(uno);
    await vi.waitFor(() => expect(bom.saved).toHaveLength(2), { timeout: 2000 });
    expect(bom.saved[1]?.items).toEqual([{ partKey: 'actuator.led?color=red', quantity: 2 }]);
  });
});
