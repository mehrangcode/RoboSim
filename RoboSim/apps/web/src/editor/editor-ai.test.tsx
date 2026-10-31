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
