import { blankProject } from '@robosim/circuit-canvas';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '../auth/use-auth.js';
import { loadStored, runKey, saveStored } from '../editor/project-store.js';
import { initI18n } from '../lib/i18n.js';
import { FakeAuth, SARA } from '../testing/fake-auth.js';
import { FakeLearning } from '../testing/fake-learning.js';
import { FakeProjects } from '../testing/fake-projects.js';
import { LearnPage } from './learn-page.js';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

afterEach(() => {
  localStorage.clear();
  navigate.mockReset();
});

async function renderPage(signedIn = false, locale: 'en' | 'fa' = 'en') {
  const i18n = await initI18n(locale);
  const learning = new FakeLearning();
  const projects = new FakeProjects();
  render(
    <I18nextProvider i18n={i18n}>
      <AuthContext value={{ me: signedIn ? SARA : null, client: new FakeAuth(), setMe: () => undefined }}>
        <LearnPage learning={learning} projects={projects} />
      </AuthContext>
    </I18nextProvider>,
  );
  const cards = await screen.findAllByRole('listitem');
  return { learning, projects, cards };
}

describe('guided projects page (FR-LRN-01, Journey A)', () => {
  it('lists the projects; one outside the plan is a teaser with a plans link', async () => {
    const { cards } = await renderPage();
    const [line, avoider] = cards.map((c) => within(c));
    expect(line?.getByRole('heading', { name: 'Robot line-follower' })).toBeInTheDocument();
    expect(line?.getByText('about 30 min · 3 steps')).toBeInTheDocument();
    expect(line?.getByRole('button', { name: 'Start' })).toBeEnabled();
    expect(avoider?.getByText('Included with the Maker plan.')).toBeInTheDocument();
    expect(avoider?.getByRole('link', { name: 'See plans' })).toHaveAttribute('href', '/plans');
    expect(avoider?.queryByRole('button', { name: 'Start' })).toBeNull();
  });

  it('a guest starts in this browser, then continues from the same card', async () => {
    const { cards } = await renderPage();
    await userEvent.click(within(cards[0] as HTMLElement).getByRole('button', { name: 'Start' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/editor' });
    expect(loadStored()?.project).toMatchObject({
      guided: { slug: 'line-follower', version: 1 },
      meta: { title: 'Robot line-follower' },
    });
  });

  it('asks before replacing a guest’s own work', async () => {
    const own = blankProject('Mine', 'void setup() {}');
    saveStored({
      project: { ...own, meta: { title: 'Mine, edited' }, wires: [] },
      pristine: runKey(blankProject('x', '')),
    });
    const { cards } = await renderPage();
    await userEvent.click(within(cards[0] as HTMLElement).getByRole('button', { name: 'Start' }));
    const dialog = await screen.findByRole('dialog', { name: 'Replace the project in this browser?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(loadStored()?.project.meta.title).toBe('Mine, edited');
    await userEvent.click(within(cards[0] as HTMLElement).getByRole('button', { name: 'Start' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Replace and start' }));
    expect(loadStored()?.project.guided?.slug).toBe('line-follower');
  });

  it('a signed-in learner gets a project in the account and continues it later', async () => {
    const { projects } = await renderPage(true);
    await userEvent.click((await screen.findAllByRole('button', { name: 'Start' }))[0] as HTMLElement);
    const created = [...projects.projects.values()][0];
    expect(created?.document.guided).toEqual({ slug: 'line-follower', version: 1 });
    expect(navigate).toHaveBeenCalledWith({ to: '/editor/$projectId', params: { projectId: created?.id } });
  });

  it('shows progress and Continue for a project in progress', async () => {
    const i18n = await initI18n('fa');
    const learning = new FakeLearning();
    learning.rows = [
      {
        contentVersionId: 'line-follower@1',
        projectId: 'p9',
        completedSteps: ['intro'],
        completedAt: null,
        updatedAt: 'x',
      },
    ];
    render(
      <I18nextProvider i18n={i18n}>
        <AuthContext value={{ me: SARA, client: new FakeAuth(), setMe: () => undefined }}>
          <LearnPage learning={learning} projects={new FakeProjects()} />
        </AuthContext>
      </I18nextProvider>,
    );
    expect(await screen.findByText('۱ از ۳ مرحله انجام شده')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'ادامه' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/editor/$projectId', params: { projectId: 'p9' } });
  });
});
