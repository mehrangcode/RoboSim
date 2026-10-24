import { blankProject } from '@robosim/circuit-canvas';
import type { BuildResult } from '@robosim/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/auth-context.js';
import type { CompileSketch } from '../lab/use-build.js';
import { initI18n } from '../lib/i18n.js';
import { ProjectsPage } from '../projects/projects-page.js';
import { FakeAuth, SARA } from '../testing/fake-auth.js';
import { FakeProjects } from '../testing/fake-projects.js';
import { FakeWorker } from '../testing/fake-worker.js';
import { EditorPage, SharedLinkPage } from './editor-page.js';

const router = vi.hoisted(() => ({
  params: {} as { projectId?: string; token?: string },
  navigate: vi.fn(),
}));
vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useParams: () => router.params,
  useNavigate: () => router.navigate,
  useLocation: () => ({ href: '/here' }),
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

afterEach(() => {
  router.params = {};
  router.navigate.mockReset();
  localStorage.clear();
});

const built: BuildResult = {
  buildId: 'b1',
  status: 'succeeded',
  cacheHit: false,
  artifact: {
    id: 'c'.repeat(64),
    format: 'ihex',
    sha256: 'c'.repeat(64),
    sizeBytes: 11,
    flashPct: 3,
    ramPct: 0.4,
    url: '/a',
  },
  diagnostics: [],
  durationMs: 9,
};
const docOf = (title: string) => blankProject(title, 'void setup() {}\nvoid loop() {}\n');

async function show(ui: ReactNode, auth = new FakeAuth(SARA)) {
  const i18n = await initI18n('en');
  const compile = vi.fn<CompileSketch>().mockResolvedValue({ result: built, hex: ':00000001FF\n' });
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider client={auth}>{ui}</AuthProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  );
  return { compile, user: userEvent.setup() };
}
const editor = (projects: FakeProjects) => (
  <EditorPage createWorker={() => new FakeWorker()} projects={projects} />
);
const toolbar = () => screen.getByRole('toolbar', { name: 'Project and simulation' });

describe('share dialog (FR-PRJ-04, owner)', () => {
  it('creates a link, allows remixes, and shares with a person by email', async () => {
    const projects = new FakeProjects();
    const p = projects.seed(docOf('Line follower'));
    router.params = { projectId: p.id };
    const { user } = await show(editor(projects));
    await user.click(
      await within(await screen.findByRole('toolbar', { name: 'Project and simulation' })).findByRole(
        'button',
        { name: 'Share' },
      ),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Share “Line follower”' });

    await user.click(await within(dialog).findByRole('button', { name: 'Create a link' }));
    expect((await within(dialog).findByLabelText<HTMLInputElement>('Share link')).value).toMatch(/\/s\//);
    await user.click(within(dialog).getByRole('checkbox', { name: /Let visitors remix/ }));
    await waitFor(() =>
      expect(projects.calls.filter((c) => c.method === 'setLink').at(-1)?.args[1]).toEqual({
        remixable: true,
      }),
    );

    await user.type(within(dialog).getByLabelText('Email of a RoboSim user'), 'bob@example.com');
    await user.selectOptions(within(dialog).getByLabelText('Access'), 'edit');
    await user.click(within(dialog).getByRole('button', { name: 'Share' }));
    expect(await within(dialog).findByText('bob@example.com')).toBeInTheDocument();
    expect(projects.calls.find((c) => c.method === 'share')?.args[1]).toEqual({
      email: 'bob@example.com',
      role: 'edit',
    });

    await user.type(within(dialog).getByLabelText('Email of a RoboSim user'), 'ghost@example.com');
    await user.click(within(dialog).getByRole('button', { name: 'Share' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('No RoboSim account uses this email.');

    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(within(dialog).queryByText('bob@example.com')).not.toBeInTheDocument());
  });
});

describe('opening a shared project (Security §4.3)', () => {
  it('a viewer gets a read-only workspace with "Make a copy"', async () => {
    const projects = new FakeProjects();
    const p = projects.seed(docOf('Maze'), { access: 'view', ownerName: 'Ana' });
    router.params = { projectId: p.id };
    const { user } = await show(editor(projects));
    expect(await screen.findByText('Shared by Ana · read-only')).toBeInTheDocument();
    expect(screen.getByLabelText<HTMLTextAreaElement>('Arduino code')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Project name')).toHaveAttribute('readonly');
    for (const name of ['Save', 'Versions', 'Share', 'Import'])
      expect(within(toolbar()).queryByRole('button', { name })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Parts' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Make a copy' }));
    await waitFor(() =>
      expect(router.navigate).toHaveBeenCalledWith({ to: '/editor/$projectId', params: { projectId: 'p2' } }),
    );
    expect(projects.calls.some((c) => c.method === 'duplicate' && c.args[0] === p.id)).toBe(true);
    expect(projects.calls.some((c) => c.method === 'save')).toBe(false);
  });

  it('an editor edits normally, without sharing controls', async () => {
    const projects = new FakeProjects();
    const p = projects.seed(docOf('Maze'), { access: 'edit', ownerName: 'Ana' });
    router.params = { projectId: p.id };
    await show(editor(projects));
    expect(await screen.findByText('Shared by Ana · you can edit')).toBeInTheDocument();
    expect(within(toolbar()).getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(within(toolbar()).queryByRole('button', { name: 'Share' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Arduino code')).not.toHaveAttribute('readonly');
  });

  it('credits the source of a remix', async () => {
    const projects = new FakeProjects();
    const p = projects.seed(docOf('Sumo'), {
      remixedFrom: { projectId: 'x', name: 'Sumo bot', author: 'Ana' },
    });
    router.params = { projectId: p.id };
    await show(editor(projects));
    expect(await screen.findByText('Remixed from “Sumo bot” by Ana')).toBeInTheDocument();
  });
});

describe('share links (US-PRJ-03)', () => {
  async function linked(remixable: boolean) {
    const projects = new FakeProjects();
    const p = projects.seed(docOf('Line follower'), { ownerName: 'Ana' });
    const sharing = await projects.setLink(p.id, { remixable });
    router.params = { token: sharing.link?.url.split('/s/')[1] ?? '' };
    return projects;
  }

  it('opens read-only for a visitor and leaves their own browser project alone', async () => {
    localStorage.setItem('robosim.editor.project.v1', JSON.stringify({ mine: true }));
    const projects = await linked(false);
    await show(<SharedLinkPage createWorker={() => new FakeWorker()} projects={projects} />, new FakeAuth());
    expect(await screen.findByText('Shared by Ana · read-only')).toBeInTheDocument();
    expect(screen.getByText("The owner hasn't allowed remixes.")).toBeInTheDocument();
    expect(screen.getByLabelText('Project name')).toHaveValue('Line follower');
    expect(localStorage.getItem('robosim.editor.project.v1')).toBe(JSON.stringify({ mine: true }));
  });

  it('asks a signed-out visitor to sign in before remixing', async () => {
    const projects = await linked(true);
    await show(<SharedLinkPage createWorker={() => new FakeWorker()} projects={projects} />, new FakeAuth());
    expect(await screen.findByRole('link', { name: 'Sign in to remix' })).toHaveAttribute('href', '/login');
  });

  it('remixes into the signed-in visitor’s projects and opens the copy', async () => {
    const projects = await linked(true);
    const { user } = await show(<SharedLinkPage createWorker={() => new FakeWorker()} projects={projects} />);
    await user.click(await screen.findByRole('button', { name: 'Remix' }));
    await waitFor(() =>
      expect(router.navigate).toHaveBeenCalledWith({ to: '/editor/$projectId', params: { projectId: 'p2' } }),
    );
    expect(projects.projects.get('p2')?.remixedFrom).toMatchObject({ name: 'Line follower', author: 'Ana' });
  });

  it('says so when the link no longer works', async () => {
    router.params = { token: 'x'.repeat(43) };
    await show(<SharedLinkPage createWorker={() => new FakeWorker()} projects={new FakeProjects()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('This link no longer works');
  });
});

describe('shared with me (FR-PRJ-04)', () => {
  it('lists projects others shared, and lets the user leave one', async () => {
    const projects = new FakeProjects();
    projects.shared = [
      {
        id: 's1',
        name: 'Ana’s maze',
        boardId: 'avr-uno',
        language: 'cpp',
        tags: [],
        revision: 3,
        createdAt: '2026-10-20T08:00:00.000Z',
        updatedAt: '2026-10-21T08:00:00.000Z',
        deletedAt: null,
        locked: false,
        role: 'edit',
        ownerName: 'Ana',
      },
    ];
    const { user } = await show(<ProjectsPage projects={projects} />);
    await user.click(await screen.findByRole('radio', { name: 'Shared with me' }));
    const list = await screen.findByRole('list', { name: 'Shared with me' });
    expect(within(list).getByRole('link', { name: 'Ana’s maze' })).toHaveAttribute(
      'href',
      '/editor/$projectId',
    );
    expect(within(list).getByText(/by Ana · Can edit/)).toBeInTheDocument();
    await user.click(within(list).getByRole('button', { name: 'Remove from my list' }));
    expect(await screen.findByText('Nothing has been shared with you yet.')).toBeInTheDocument();
    expect(projects.calls.find((c) => c.method === 'unshare')?.args).toEqual(['s1', SARA.id]);
  });
});
