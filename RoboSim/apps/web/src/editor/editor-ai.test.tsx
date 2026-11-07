import { blankProject } from '@robosim/circuit-canvas';
import type { AiProposal } from '@robosim/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '../auth/use-auth.js';
import { initI18n } from '../lib/i18n.js';
import { FakeAi, answer } from '../testing/fake-ai.js';
import { FakeAuth, SARA } from '../testing/fake-auth.js';
import { FakeProjects } from '../testing/fake-projects.js';
import { FakeWorker } from '../testing/fake-worker.js';
import { EditorPage } from './editor-page.js';

const router = vi.hoisted(() => ({ params: {} as { projectId?: string } }));
vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useParams: () => router.params,
  useNavigate: () => vi.fn(),
  useLocation: () => ({ href: '/editor' }),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

afterEach(() => {
  router.params = {};
  localStorage.clear();
});

const SKETCH = 'void setup() {}\nvoid loop() {\n  int l = analogRead(A0);\n  if (l > 500) stop();\n}\n';

describe('AI suggestions in the editor (US-AI-02 AC1)', () => {
  it('applies a code suggestion and keeps it as a version of the cloud project', async () => {
    const projects = new FakeProjects();
    projects.seed(blankProject('Line follower', SKETCH), { id: 'p1' });
    router.params = { projectId: 'p1' };
    const ai = new FakeAi();
    const proposal: AiProposal = {
      id: 'x',
      kind: 'code_patch',
      summary: 'Invert the line check',
      file: 'sketch.ino',
      edits: [{ find: 'l > 500', replace: 'l < 500' }],
      unifiedDiff:
        '--- a/sketch.ino\n+++ b/sketch.ino\n@@ -4,1 +4,1 @@\n-  if (l > 500) stop();\n+  if (l < 500) stop();\n',
    };
    ai.scripts.push(answer('The check is inverted.', [{ event: 'proposal', data: proposal }]));
    const i18n = await initI18n('en');
    const user = userEvent.setup();
    render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={new QueryClient()}>
          <AuthContext value={{ me: SARA, client: new FakeAuth(), setMe: () => undefined }}>
            <EditorPage createWorker={() => new FakeWorker()} projects={projects} ai={ai} />
          </AuthContext>
        </QueryClientProvider>
      </I18nextProvider>,
    );
    expect(await screen.findByDisplayValue('Line follower')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Assistant' }));
    await user.type(await screen.findByLabelText('Your question', {}, { timeout: 10_000 }), 'Why?');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    // The question carried the project as it is on screen.
    await waitFor(() => expect(ai.requests).toHaveLength(1));
    expect(ai.requests[0]).toMatchObject({ projectId: 'p1', context: { currentFile: 'sketch.ino' } });
    const doc = ai.requests[0]?.context?.document as { code: { files: { content: string }[] } };
    expect(doc.code.files[0]?.content).toBe(SKETCH);

    const card = await screen.findByRole('region', { name: 'Suggested change to sketch.ino' });
    await user.click(within(card).getByRole('button', { name: 'Apply' }));
    expect(screen.getByLabelText<HTMLTextAreaElement>('Arduino code').value).toContain(
      'if (l < 500) stop();',
    );
    await waitFor(() =>
      expect(projects.calls.find((c) => c.method === 'checkpoint')?.args).toEqual([
        'p1',
        'AI: Invert the line check',
      ]),
    );
    const saved = projects.calls.filter((c) => c.method === 'save').at(-1)?.args[2] as {
      code: { files: { content: string }[] };
    };
    expect(saved.code.files[0]?.content).toContain('l < 500');
  }, 30_000);
});

describe('Ask AI from the library search (US-CIR-09 AC4)', () => {
  async function renderEditor(signedIn: boolean, ai = new FakeAi()) {
    const i18n = await initI18n('en');
    render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={new QueryClient()}>
          <AuthContext value={{ me: signedIn ? SARA : null, client: new FakeAuth(), setMe: () => undefined }}>
            <EditorPage createWorker={() => new FakeWorker()} projects={new FakeProjects()} ai={ai} />
          </AuthContext>
        </QueryClientProvider>
      </I18nextProvider>,
    );
    return { user: userEvent.setup(), ai };
  }

  it('a weak search offers Ask AI, which fills the question box without sending', async () => {
    const { user, ai } = await renderEditor(true);
    const search = await screen.findByRole('searchbox', { name: 'Search parts (English or Persian)' });
    await user.type(search, 'measure distance');
    expect(screen.queryByRole('button', { name: /Ask AI/ })).not.toBeInTheDocument();
    await user.clear(search);
    await user.type(search, 'teleport the cat');
    await user.click(await screen.findByRole('button', { name: /Ask AI/ }));
    expect(
      await screen.findByDisplayValue('Which part can: teleport the cat?', {}, { timeout: 10_000 }),
    ).toBeInTheDocument();
    expect(ai.requests).toHaveLength(0);
  }, 30_000);

  it('signed out: no Ask AI, the search still works offline', async () => {
    const { user } = await renderEditor(false);
    const search = await screen.findByRole('searchbox', { name: 'Search parts (English or Persian)' });
    await user.type(search, 'teleport the cat');
    expect(screen.getByText('No part matches.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ask AI/ })).not.toBeInTheDocument();
    await user.clear(search);
    await user.type(search, 'drive two motors');
    expect(screen.getAllByRole('button', { name: /^Add / })[0]).toHaveAccessibleName(
      'Add L298N motor driver',
    );
  }, 30_000);
});
