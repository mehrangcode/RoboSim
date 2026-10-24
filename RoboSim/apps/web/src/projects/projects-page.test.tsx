import { blankProject } from '@robosim/circuit-canvas';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../lib/i18n.js';
import { AuthProvider } from '../auth/auth-context.js';
import { FakeAuth, SARA } from '../testing/fake-auth.js';
import { FakeEntitlements, planError } from '../testing/fake-entitlements.js';
import { FakeProjects } from '../testing/fake-projects.js';
import { ProjectsPage } from './projects-page.js';

const router = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => router.navigate,
  Link: ({ children, params }: { children: React.ReactNode; params?: { projectId: string } }) => (
    <a href={`/editor/${params?.projectId ?? ''}`}>{children}</a>
  ),
}));

afterEach(() => router.navigate.mockReset());

async function setup(
  projects: FakeProjects,
  lang: 'en' | 'fa' = 'en',
  entitlements: FakeEntitlements = new FakeEntitlements(),
) {
  const i18n = await initI18n(lang);
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider client={new FakeAuth(SARA)}>
          <ProjectsPage projects={projects} entitlements={entitlements} />
        </AuthProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  );
  return userEvent.setup();
}

const list = () => screen.getByRole('list', { name: 'My projects' });
const row = (name: string) => {
  const item = within(list())
    .getAllByRole('listitem')
    .find((li) => li.textContent?.includes(name));
  if (!item) throw new Error(`no row ${name}`);
  return item;
};

describe('projects page (FR-PRJ-01)', () => {
  it('lists projects newest first, links them to the editor, and searches', async () => {
    const projects = new FakeProjects();
    projects.seed(blankProject('Blink', ''), { id: 'a' });
    projects.seed(blankProject('Line follower', ''), { id: 'b' });
    const user = await setup(projects);
    await screen.findByRole('list', { name: 'My projects' });
    expect(
      within(list())
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Line follower', 'Blink']);
    expect(screen.getByRole('link', { name: 'Blink' })).toHaveAttribute('href', '/editor/a');
    await user.type(screen.getByRole('searchbox', { name: 'Search projects' }), 'line');
    await waitFor(() =>
      expect(
        within(list())
          .getAllByRole('link')
          .map((a) => a.textContent),
      ).toEqual(['Line follower']),
    );
  });

  it('creates a project from the starter and opens it', async () => {
    const projects = new FakeProjects();
    const user = await setup(projects);
    expect(await screen.findByText(/No projects yet/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New project' }));
    await waitFor(() => expect(router.navigate).toHaveBeenCalled());
    const [created] = [...projects.projects.values()];
    expect(created?.document.components.length).toBeGreaterThan(0);
    expect(router.navigate).toHaveBeenCalledWith({
      to: '/editor/$projectId',
      params: { projectId: created?.id },
    });
  });

  it('renames, duplicates, deletes with undo, and restores from the trash', async () => {
    const projects = new FakeProjects();
    projects.seed(blankProject('Servo', ''), { id: 's' });
    const user = await setup(projects);
    await screen.findByRole('list', { name: 'My projects' });

    await user.click(within(row('Servo')).getByRole('button', { name: 'Rename' }));
    const input = within(row('')).getByRole('textbox', { name: 'Rename' });
    await user.clear(input);
    await user.type(input, 'Servo sweep{Enter}');
    await screen.findByRole('link', { name: 'Servo sweep' });
    expect(projects.calls.find((c) => c.method === 'update')?.args).toEqual([
      's',
      1,
      { name: 'Servo sweep' },
    ]);

    await user.click(within(row('Servo sweep')).getByRole('button', { name: 'Duplicate' }));
    await screen.findByRole('link', { name: 'Servo sweep (copy)' });

    await user.click(within(row('Servo sweep (copy)')).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('"Servo sweep (copy)" moved to the trash.')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Servo sweep (copy)' })).not.toBeInTheDocument(),
    );
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await screen.findByRole('link', { name: 'Servo sweep (copy)' });

    await user.click(within(row('Servo sweep (copy)')).getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Trash', pressed: false }));
    await waitFor(() => expect(within(list()).getAllByRole('listitem')).toHaveLength(1));
    expect(row('Servo sweep (copy)')).toHaveTextContent(/Deleted/);
    await user.click(within(row('Servo sweep (copy)')).getByRole('button', { name: 'Restore' }));
    expect(await screen.findByText(/The trash is empty/)).toBeInTheDocument();
  });

  it('reports a server that cannot be reached', async () => {
    const projects = new FakeProjects();
    projects.offline = true;
    await setup(projects);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your projects');
  });

  it('speaks Persian', async () => {
    const projects = new FakeProjects();
    await setup(projects, 'fa');
    expect(await screen.findByRole('heading', { name: 'پروژه‌های من' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'پروژهٔ جدید' })).toBeInTheDocument();
  });
});

describe('plan limits on the projects page (PRD §3, FR-BIL-05)', () => {
  it('marks projects over the cap read-only and shows the cloud project count', async () => {
    const projects = new FakeProjects();
    projects.seed(blankProject('Old one', ''), { id: 'a', locked: true });
    projects.seed(blankProject('New one', ''), { id: 'b' });
    const entitlements = new FakeEntitlements();
    entitlements.projectsUsed = 4;
    await setup(projects, 'en', entitlements);
    await screen.findByRole('list', { name: 'My projects' });
    expect(within(row('Old one')).getByText('Read-only')).toBeInTheDocument();
    expect(within(row('Old one')).queryByRole('button', { name: 'Rename' })).toBeNull();
    expect(within(row('New one')).queryByText('Read-only')).toBeNull();
    expect(await screen.findByText(/4 of 3 cloud projects/)).toBeInTheDocument();
  });

  it('opens the paywall when the cap refuses a new project', async () => {
    const projects = new FakeProjects();
    projects.refusals.set('create', planError('quota_exceeded', { quota: 'projects.cloud_max', limit: 3 }));
    const user = await setup(projects);
    await user.click(await screen.findByRole('button', { name: 'New project' }));
    const dialog = await screen.findByRole('dialog', { name: 'This needs the Maker plan' });
    expect(dialog).toHaveTextContent('Your plan keeps 3 projects in the cloud.');
    expect(within(dialog).getByRole('link', { name: 'See plans' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
