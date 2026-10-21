import { blankProject } from '@robosim/circuit-canvas';
import type { BuildResult, ProjectDocument } from '@robosim/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompileSketch } from '../lab/use-build.js';
import { initI18n } from '../lib/i18n.js';
import { FakeProjects } from '../testing/fake-projects.js';
import { FakeWorker } from '../testing/fake-worker.js';
import { EditorPage } from './editor-page.js';

const router = vi.hoisted(() => ({ params: {} as { projectId?: string }, navigate: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useParams: () => router.params,
  useNavigate: () => router.navigate,
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

afterEach(() => {
  router.params = {};
  router.navigate.mockReset();
  localStorage.clear();
  vi.restoreAllMocks();
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

const sketch = (n: number) => `// v${n}\nvoid setup() {}\nvoid loop() {}\n`;
const docOf = (title: string, n = 1): ProjectDocument => blankProject(title, sketch(n));

async function setup(projects: FakeProjects, projectId?: string) {
  if (projectId) router.params = { projectId };
  const i18n = await initI18n('en');
  const compile = vi.fn<CompileSketch>().mockResolvedValue({ result: built, hex: ':00000001FF\n' });
  render(
    <I18nextProvider i18n={i18n}>
      <EditorPage createWorker={() => new FakeWorker()} compileSketch={compile} projects={projects} />
    </I18nextProvider>,
  );
  return { compile, user: userEvent.setup() };
}

const toolbar = () => screen.getByRole('toolbar', { name: 'Project and simulation' });
const cloudStatus = () => within(toolbar()).getAllByRole('status').at(-1);
const title = () => screen.getByLabelText<HTMLInputElement>('Project name');
const code = () => screen.getByLabelText<HTMLTextAreaElement>('Arduino code');
const saves = (projects: FakeProjects) => projects.calls.filter((c) => c.method === 'save');

async function rename(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.clear(title());
  await user.type(title(), name);
  await user.tab();
}

describe('cloud projects in the editor (API Spec §4.4)', () => {
  it('opens the saved project and saves edits with If-Match on Ctrl+S', async () => {
    const projects = new FakeProjects();
    projects.seed(docOf('Line follower'), { id: 'p1' });
    const { user } = await setup(projects, 'p1');
    expect(await screen.findByDisplayValue('Line follower')).toBeInTheDocument();
    expect(cloudStatus()).toHaveTextContent('Saved');

    await rename(user, 'Line follower v2');
    expect(cloudStatus()).toHaveTextContent('Unsaved changes');
    await user.keyboard('{Control>}s{/Control}');
    await waitFor(() => expect(cloudStatus()).toHaveTextContent('Saved'));
    expect(saves(projects)[0]?.args.slice(0, 2)).toEqual(['p1', 1]);
    expect(projects.projects.get('p1')?.name).toBe('Line follower v2');

    // The next save is based on the new revision.
    await rename(user, 'Line follower v3');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saves(projects)).toHaveLength(2));
    expect(saves(projects)[1]?.args[1]).toBe(2);
  });

  it('keeps unsaved edits in this browser and saves when the tab is hidden', async () => {
    const projects = new FakeProjects();
    projects.seed(docOf('Draft'), { id: 'p1' });
    const { user } = await setup(projects, 'p1');
    await screen.findByDisplayValue('Draft');
    await rename(user, 'Draft 2');
    const stored = JSON.parse(localStorage.getItem('robosim.editor.cloud.v1.p1') ?? 'null') as {
      baseRevision: number;
      document: ProjectDocument;
    };
    expect(stored).toMatchObject({ baseRevision: 1, document: { meta: { title: 'Draft 2' } } });

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    fireEvent(document, new Event('visibilitychange'));
    await waitFor(() => expect(cloudStatus()).toHaveTextContent('Saved'));
    expect(localStorage.getItem('robosim.editor.cloud.v1.p1')).toBeNull();
  });

  it('reopens with this browser’s draft when the server has not moved on', async () => {
    const projects = new FakeProjects();
    projects.seed(docOf('Server'), { id: 'p1' });
    localStorage.setItem(
      'robosim.editor.cloud.v1.p1',
      JSON.stringify({ baseRevision: 1, document: docOf('Local edits') }),
    );
    await setup(projects, 'p1');
    expect(await screen.findByDisplayValue('Local edits')).toBeInTheDocument();
    expect(cloudStatus()).toHaveTextContent('Unsaved changes');
  });

  it('a stale draft asks the user; keeping it overwrites the newer server copy', async () => {
    const projects = new FakeProjects();
    projects.seed(docOf('Server'), { id: 'p1' });
    projects.saveElsewhere('p1', docOf('Server, newer'));
    localStorage.setItem(
      'robosim.editor.cloud.v1.p1',
      JSON.stringify({ baseRevision: 1, document: docOf('Mine') }),
    );
    const { user } = await setup(projects, 'p1');
    const dialog = await screen.findByRole('dialog', { name: 'This project changed elsewhere' });
    expect(dialog).toHaveTextContent('This browser has unsaved changes');
    expect(title().value).toBe('Server, newer');
    await user.click(within(dialog).getByRole('button', { name: 'Keep my changes' }));
    await waitFor(() => expect(title().value).toBe('Mine'));
    expect(saves(projects).at(-1)?.args.slice(0, 2)).toEqual(['p1', 2]);
    expect(projects.projects.get('p1')?.name).toBe('Mine');
    expect(cloudStatus()).toHaveTextContent('Saved');
  });

  it('a save rejected with 412 asks; using the saved version loads it', async () => {
    const projects = new FakeProjects();
    projects.seed(docOf('Shared'), { id: 'p1' });
    const { user } = await setup(projects, 'p1');
    await screen.findByDisplayValue('Shared');
    projects.saveElsewhere('p1', docOf('From the other tab', 7));
    await rename(user, 'From this tab');
    await user.keyboard('{Control>}s{/Control}');
    const dialog = await screen.findByRole('dialog', { name: 'This project changed elsewhere' });
    expect(cloudStatus()).toHaveTextContent('Conflict');
    await user.click(within(dialog).getByRole('button', { name: 'Use the saved version' }));
    await waitFor(() => expect(title().value).toBe('From the other tab'));
    expect(code().value).toContain('// v7');
    expect(cloudStatus()).toHaveTextContent('Saved');
  });

  it('shows Offline when the server cannot be reached, and saves when it comes back', async () => {
    const projects = new FakeProjects();
    projects.seed(docOf('Trip'), { id: 'p1' });
    const { user } = await setup(projects, 'p1');
    await screen.findByDisplayValue('Trip');
    projects.offline = true;
    await rename(user, 'On the train');
    await user.keyboard('{Control>}s{/Control}');
    await waitFor(() => expect(cloudStatus()).toHaveTextContent('Offline'));
    expect(localStorage.getItem('robosim.editor.cloud.v1.p1')).toContain('On the train');
    projects.offline = false;
    fireEvent(window, new Event('online'));
    await waitFor(() => expect(cloudStatus()).toHaveTextContent('Saved'));
    expect(projects.projects.get('p1')?.name).toBe('On the train');
  });

  it('Run saves first and builds with the project id, so the build becomes a version (FR-PRJ-03)', async () => {
    const projects = new FakeProjects();
    projects.seed(docOf('Builder'), { id: 'p1' });
    const { user, compile } = await setup(projects, 'p1');
    await screen.findByDisplayValue('Builder');
    await user.type(code(), '// edit');
    await user.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(compile).toHaveBeenCalledTimes(1));
    expect(compile.mock.calls[0]?.[0]).toMatchObject({ projectId: 'p1' });
    expect(projects.projects.get('p1')?.document.code.files[0]?.content).toContain('// edit');
  });

  it('checkpoints and restores versions', async () => {
    const projects = new FakeProjects();
    projects.seed(docOf('History', 1), { id: 'p1' });
    projects.addVersion('p1', null, 'auto_build');
    projects.saveElsewhere('p1', docOf('History', 2));
    const { user } = await setup(projects, 'p1');
    await screen.findByDisplayValue('History');
    expect(code().value).toContain('// v2');

    await user.click(screen.getByRole('button', { name: 'Versions' }));
    const dialog = await screen.findByRole('dialog', { name: 'Versions' });
    expect(
      await within(dialog).findByText('Successful build', { selector: '.font-medium' }),
    ).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Checkpoint name'), 'Before the motor{Enter}');
    expect(await within(dialog).findByText('Before the motor')).toBeInTheDocument();

    const v1 = within(dialog).getAllByRole('listitem').at(-1);
    if (!v1) throw new Error('no v1');
    await user.click(within(v1).getByRole('button', { name: 'Restore' }));
    await user.click(within(v1).getByRole('button', { name: 'Restore this version' }));
    await waitFor(() => expect(code().value).toContain('// v1'));
    expect(within(dialog).getAllByRole('listitem')[0]).toHaveTextContent('v1');
    expect(cloudStatus()).toHaveTextContent('Saved');
  });

  it('explains a missing project', async () => {
    await setup(new FakeProjects(), 'gone');
    expect(await screen.findByRole('alert')).toHaveTextContent('does not exist or was deleted');
    expect(screen.getByRole('link', { name: 'All projects' })).toHaveAttribute('href', '/projects');
  });

  it('the browser project can be saved to my projects', async () => {
    const projects = new FakeProjects();
    const { user } = await setup(projects);
    await user.click(screen.getByRole('button', { name: 'Save to my projects' }));
    await waitFor(() => expect(router.navigate).toHaveBeenCalled());
    const [created] = [...projects.projects.values()];
    expect(created?.document.code.files[0]?.content).toContain('digitalWrite(13, HIGH)');
    expect(router.navigate).toHaveBeenCalledWith({
      to: '/editor/$projectId',
      params: { projectId: created?.id },
    });
  });
});
