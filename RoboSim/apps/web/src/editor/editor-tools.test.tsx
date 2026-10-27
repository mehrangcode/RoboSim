import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '../auth/use-auth.js';
import { initI18n } from '../lib/i18n.js';
import { FakeAuth, SARA } from '../testing/fake-auth.js';
import { FakeWorker } from '../testing/fake-worker.js';
import { EditorPage } from './editor-page.js';

// The library dialog and its docs are a lazy chunk: under a loaded machine (turbo runs packages in
// parallel) importing it can take well over findBy's default second.
const LAZY = { timeout: 10_000 };
vi.setConfig({ testTimeout: 20_000 });

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useParams: () => ({}),
  useNavigate: () => vi.fn(),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

afterEach(() => localStorage.clear());

async function setup(auth?: FakeAuth, lng: 'en' | 'fa' = 'en') {
  const i18n = await initI18n(lng);
  const page = <EditorPage createWorker={() => new FakeWorker()} />;
  render(
    <I18nextProvider i18n={i18n}>
      {auth ? (
        <AuthContext value={{ me: auth.user, client: auth, setMe: (me) => (auth.user = me) }}>
          {page}
        </AuthContext>
      ) : (
        page
      )}
    </I18nextProvider>,
  );
  return userEvent.setup();
}

const code = () => screen.getByLabelText<HTMLTextAreaElement>('Arduino code');

describe('command palette (FR-WRK-05)', () => {
  it('opens with Ctrl+K, finds parts in either language and runs workspace actions', async () => {
    const user = await setup();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const palette = screen.getByRole('dialog', { name: 'Command palette' });
    const input = within(palette).getByRole('combobox');
    expect(within(palette).getByRole('option', { name: /Run/ })).toBeInTheDocument();

    await user.type(input, 'مقاومت');
    expect(within(palette).getByRole('option', { name: /Add part: Resistor/ })).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, 'librar');
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
    expect(await screen.findByRole('dialog', { name: 'Libraries' }, LAZY)).toBeInTheDocument();
  });
});

describe('library manager (FR-COD-07)', () => {
  it('lists pinned libraries with versions and adds their includes to the open file', async () => {
    const user = await setup();
    await user.click(screen.getByRole('button', { name: 'Libraries' }));
    const dialog = await screen.findByRole('dialog', { name: 'Libraries' }, LAZY);
    expect(within(dialog).getByText('2.5.17')).toBeInTheDocument(); // Adafruit_SSD1306
    await user.type(within(dialog).getByRole('searchbox'), 'servo');
    await user.click(within(dialog).getByRole('button', { name: 'Add Servo' }));
    expect(code().value.startsWith('#include <Servo.h>\n')).toBe(true);
    expect(within(dialog).getByRole('button', { name: 'Add Servo' })).toBeDisabled();
    // The project pins the version (US-COD AC1): saved with the project.
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    const stored = JSON.parse(localStorage.getItem('robosim.editor.project.v1') ?? '{}') as {
      project?: { libraries?: unknown };
    };
    expect(stored.project?.libraries).toEqual([{ name: 'Servo', version: '1.3.0' }]);
  });
});

describe('onboarding tour (FR-WRK-06)', () => {
  it('opens on a guest first visit, can be skipped, and does not come back', async () => {
    localStorage.removeItem('robosim.editor.tourDone');
    const user = await setup();
    const tour = await screen.findByRole('dialog', { name: 'Welcome to the RoboSim editor' }, LAZY);
    expect(within(tour).getByText('Step 1 of 7')).toBeInTheDocument();
    await user.click(within(tour).getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('dialog', { name: 'Parts library' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Skip tour' }));
    expect(screen.queryByRole('dialog', { name: 'Parts library' })).not.toBeInTheDocument();
    expect(localStorage.getItem('robosim.editor.tourDone')).not.toBeNull();
  });

  it('is remembered per account and re-opens from Help', async () => {
    localStorage.removeItem('robosim.editor.tourDone');
    const auth = new FakeAuth();
    auth.user = { ...SARA, editorTourCompletedAt: null };
    const user = await setup(auth);
    const tour = await screen.findByRole('dialog', { name: 'Welcome to the RoboSim editor' }, LAZY);
    fireEvent.keyDown(tour, { key: 'Escape' });
    await act(async () => undefined);
    expect(auth.calls).toContainEqual({ method: 'updateMe', args: [{ editorTourCompleted: true }] });
    expect(auth.user?.editorTourCompletedAt).not.toBeNull();

    fireEvent.keyDown(window, { key: 'F1' });
    await user.click(screen.getByRole('button', { name: 'Take the tour' }));
    expect(screen.getByRole('dialog', { name: 'Welcome to the RoboSim editor' })).toBeInTheDocument();
  });

  it('does not open for an account that has finished it on another device', async () => {
    localStorage.removeItem('robosim.editor.tourDone');
    const auth = new FakeAuth();
    auth.user = SARA;
    await setup(auth);
    await act(async () => undefined);
    expect(screen.queryByRole('dialog', { name: 'Welcome to the RoboSim editor' })).not.toBeInTheDocument();
  });
});
