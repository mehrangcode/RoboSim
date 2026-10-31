import type { AiProposal, ChatContext } from '@robosim/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { AuthContext } from '../auth/use-auth.js';
import { initI18n } from '../lib/i18n.js';
import { FakeAuth, SARA, problem } from '../testing/fake-auth.js';
import { FakeAi, answer } from '../testing/fake-ai.js';
import { AiPanel } from './ai-panel.js';

vi.mock('@tanstack/react-router', () => ({
  useLocation: () => ({ href: '/editor' }),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

const CODE: AiProposal = {
  id: 'p1',
  kind: 'code_patch',
  summary: 'Invert the line check',
  file: 'main.ino',
  edits: [{ find: '> 500', replace: '< 500' }],
  unifiedDiff: '--- a/main.ino\n+++ b/main.ino\n@@ -4,1 +4,1 @@\n-  if (l > 500) {\n+  if (l < 500) {\n',
};
const CIRCUIT: AiProposal = {
  id: 'p2',
  kind: 'circuit_change',
  summary: 'Add a resistor',
  changes: [
    { op: 'add_component', id: 'r2', type: 'passive.resistor', props: { ohms: 220 } },
    { op: 'add_wire', from: { part: 'board', pin: 'D9' }, to: { part: 'r2', pin: '1' } },
  ],
};

async function renderPanel(
  opts: {
    signedIn?: boolean;
    locale?: 'en' | 'fa';
    onApply?: (p: AiProposal) => string | null;
    readOnly?: boolean;
  } = {},
) {
  const i18n = await initI18n(opts.locale ?? 'en');
  const ai = new FakeAi();
  const onPaywall = vi.fn();
  const context = vi.fn((): ChatContext => ({ currentFile: 'main.ino', serialTail: ['L=812'] }));
  const onApply = opts.onApply ?? vi.fn(() => null);
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AuthContext
          value={{
            me: opts.signedIn === false ? null : SARA,
            client: new FakeAuth(),
            setMe: () => undefined,
          }}
        >
          <AiPanel
            client={ai}
            projectId="01930000-0000-7000-8000-0000000000aa"
            context={context}
            onApply={opts.readOnly ? undefined : onApply}
            onPaywall={onPaywall}
          />
        </AuthContext>
      </QueryClientProvider>
    </I18nextProvider>,
  );
  return { ai, onPaywall, context, onApply };
}

const ask = async (text: string) => {
  await userEvent.type(screen.getByLabelText('Your question'), text);
  await userEvent.click(screen.getByRole('button', { name: 'Send' }));
};

describe('AI assistant panel (FR-AI-01, FR-AI-05)', () => {
  it('asks guests to sign in', async () => {
    await renderPanel({ signedIn: false });
    expect(screen.getByText('Sign in to use the assistant')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });

  it('streams an answer with the editor context and updates the credit meter (US-AI-03 AC1)', async () => {
    const { ai, context } = await renderPanel();
    expect(await screen.findByTestId('ai-credits')).toHaveTextContent(
      '19,000 of 20,000 tokens left this month',
    );
    ai.scripts.push(answer('Your sensor condition on line 4 is inverted.'));
    await ask('Why does it not follow the line?');
    expect(await screen.findByText('Your sensor condition on line 4 is inverted.')).toBeInTheDocument();
    expect(context).toHaveBeenCalledOnce();
    expect(ai.requests[0]).toMatchObject({
      message: 'Why does it not follow the line?',
      locale: 'en',
      projectId: '01930000-0000-7000-8000-0000000000aa',
      context: { currentFile: 'main.ino', serialTail: ['L=812'] },
    });
    expect(screen.getByTestId('ai-credits')).toHaveTextContent('18,650 of 20,000');

    // The follow-up continues the same conversation.
    await ask('And now?');
    await screen.findAllByText('OK.');
    expect(ai.requests[1]?.conversationId).toBe('01930000-0000-7000-8000-00000000c001');
  });

  it('shows suggestions as a diff and a change list, applied only on request (US-AI-02 AC1)', async () => {
    const onApply = vi.fn((p: AiProposal) =>
      p.kind === 'circuit_change' ? 'change 1: id r2 is taken' : null,
    );
    const { ai } = await renderPanel({ onApply });
    ai.scripts.push(
      answer('Two fixes.', [
        { event: 'proposal', data: CODE },
        { event: 'proposal', data: CIRCUIT },
      ]),
    );
    await ask('fix it');
    const code = await screen.findByRole('region', { name: 'Suggested change to main.ino' });
    expect(within(code).getByLabelText('Lines removed and added')).toHaveTextContent(
      'removed: - if (l > 500) {added: + if (l < 500) {',
    );
    const circuit = screen.getByRole('region', { name: 'Suggested circuit change' });
    expect(within(circuit).getByText('Add Resistor as r2')).toBeInTheDocument();
    expect(within(circuit).getByText('Wire board:D9 to r2:1')).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();

    await userEvent.click(within(code).getByRole('button', { name: 'Apply' }));
    expect(onApply).toHaveBeenCalledWith(CODE);
    expect(within(code).getByRole('status')).toHaveTextContent('Applied');

    await userEvent.click(within(circuit).getByRole('button', { name: 'Apply' }));
    expect(within(circuit).getByRole('alert')).toHaveTextContent('Could not apply: change 1: id r2 is taken');
  });

  it('offers no Apply on a read-only project', async () => {
    const { ai } = await renderPanel({ readOnly: true });
    ai.scripts.push(answer('x', [{ event: 'proposal', data: CODE }]));
    await ask('fix');
    const code = await screen.findByRole('region', { name: 'Suggested change to main.ino' });
    expect(within(code).queryByRole('button', { name: 'Apply' })).toBeNull();
  });

  it('explains refusals and opens the paywall at zero credits', async () => {
    const { ai, onPaywall } = await renderPanel();
    ai.scripts.push(problem('rate_limited', 429, { retryAfter: 42 }));
    await ask('one more');
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again in 42 seconds');
    // The refused question goes back so it can be sent again.
    expect(screen.queryByText('one more', { selector: 'li' })).toBeNull();

    ai.scripts.push(
      problem('ai_credits_exhausted', 429, { allowance: 20000, resetAt: '2026-11-30T20:30:00.000Z' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await ask('again');
    await vi.waitFor(() =>
      expect(onPaywall).toHaveBeenCalledWith({ kind: 'aiCredits', resetAt: '2026-11-30T20:30:00.000Z' }),
    );
  });

  it('marks a filtered answer and a provider failure', async () => {
    const { ai } = await renderPanel();
    ai.scripts.push([
      { event: 'start', data: { conversationId: 'c', provider: 'platform', model: 'm' } },
      { event: 'delta', data: { text: 'Here is how to' } },
      { event: 'filtered', data: { category: 'weapons' } },
      { event: 'done', data: { messageId: 'm' } },
    ]);
    await ask('q');
    expect(await screen.findByText(/stopped by the safety filter/)).toBeInTheDocument();
    expect(screen.queryByText('Here is how to')).toBeNull();

    ai.scripts.push([
      { event: 'start', data: { conversationId: 'c', provider: 'platform', model: 'm' } },
      { event: 'error', data: { code: 'provider_error', message: 'model not found' } },
    ]);
    await ask('q2');
    expect(await screen.findByText('The model service failed: model not found')).toBeInTheDocument();
  });

  it('works in Persian', async () => {
    const { ai } = await renderPanel({ locale: 'fa' });
    ai.scripts.push(answer('شرط حسگر برعکس است.'));
    await userEvent.type(screen.getByLabelText('پرسش شما'), 'چرا؟');
    await userEvent.click(screen.getByRole('button', { name: 'ارسال' }));
    expect(await screen.findByText('شرط حسگر برعکس است.')).toBeInTheDocument();
    expect(ai.requests[0]?.locale).toBe('fa');
    expect(screen.getByTestId('ai-credits')).toHaveTextContent('۱۸٬۶۵۰ از ۲۰٬۰۰۰');
  });
});
