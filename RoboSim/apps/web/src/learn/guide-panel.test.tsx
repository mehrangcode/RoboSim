import { blankProject } from '@robosim/circuit-canvas';
import type { ProjectDocument } from '@robosim/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '../auth/use-auth.js';
import { initI18n } from '../lib/i18n.js';
import { FakeAuth, SARA } from '../testing/fake-auth.js';
import { FakeLearning } from '../testing/fake-learning.js';
import { GuidePanel, type GuidePanelProps } from './guide-panel.js';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

afterEach(() => localStorage.clear());

/** A guided document with the L298N's IN1 wired to `pin` (or not wired). */
function docWith(pin?: string): ProjectDocument {
  return {
    ...blankProject('Robot', ''),
    guided: { slug: 'line-follower', version: 1 },
    components: [
      {
        id: 'drv',
        type: 'driver.l298n',
        typeVersion: '1.0.0',
        x: 0,
        y: 0,
        rotation: 0,
        flipped: false,
        props: {},
      },
    ],
    wires: pin
      ? [
          {
            id: 'w1',
            from: { part: 'board', pin },
            to: { part: 'drv', pin: 'in1' },
            color: 'yellow',
            points: [],
          },
        ]
      : [],
  };
}

const guest = () => JSON.parse(localStorage.getItem('robosim.guided.v1') ?? '{}') as Record<string, unknown>;

async function renderGuide(
  over: Partial<GuidePanelProps> = {},
  locale: 'en' | 'fa' = 'en',
  signedIn = false,
) {
  const i18n = await initI18n(locale);
  const props: GuidePanelProps = {
    guided: { slug: 'line-follower', version: 1 },
    doc: docWith(),
    client: new FakeLearning(),
    runSucceeded: false,
    projectId: null,
    onShow: vi.fn(),
    onOpenParts: vi.fn(),
    ...over,
  };
  const ui = (p: GuidePanelProps) => (
    <I18nextProvider i18n={i18n}>
      <AuthContext value={{ me: signedIn ? SARA : null, client: new FakeAuth(), setMe: () => undefined }}>
        <GuidePanel {...p} />
      </AuthContext>
    </I18nextProvider>
  );
  const view = render(ui(props));
  return { props, rerender: (next: Partial<GuidePanelProps>) => view.rerender(ui({ ...props, ...next })) };
}

describe('guide panel (FR-LRN-01, US-LRN-01)', () => {
  it('walks through a reading step and records it for a guest', async () => {
    await renderGuide();
    expect(await screen.findByRole('heading', { name: 'Meet your robot' })).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('heading', { name: 'Speed pin on PWM' })).toBeInTheDocument();
    expect(guest()).toEqual({
      'line-follower@1': { completedSteps: ['intro'], completedAt: null, projectId: null },
    });
  });

  it('AC1: IN1 on D4 explains PWM pins; on D5 the step completes', async () => {
    localStorage.setItem(
      'robosim.guided.v1',
      JSON.stringify({ 'line-follower@1': { completedSteps: ['intro'] } }),
    );
    const { props, rerender } = await renderGuide({ doc: docWith('D4') });
    expect(
      await screen.findByText(
        'IN1 of the L298N motor driver is on D4, which cannot do PWM: only the pins marked ~ can switch fast enough to set a speed. Use one of D3, D5, D6, D9, D10, D11.',
      ),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show me' }));
    expect(props.onShow).toHaveBeenCalledWith(['drv']);

    rerender({ doc: docWith('D5') });
    expect(await screen.findByRole('heading', { name: 'Run a lap' })).toBeInTheDocument();
    const steps = within(screen.getByRole('navigation', { name: 'Steps' }));
    expect(steps.getByRole('button', { name: /Speed pin on PWM/ })).toHaveTextContent('done');
  });

  it('AC2: a successful run completes the project and records it', async () => {
    const client = new FakeLearning();
    client.rows = [
      {
        contentVersionId: 'line-follower@1',
        projectId: null,
        completedSteps: ['intro'],
        completedAt: null,
        updatedAt: 'x',
      },
    ];
    const { props, rerender } = await renderGuide(
      { doc: docWith('D9'), client, projectId: 'p1' },
      'en',
      true,
    );
    expect(await screen.findByRole('heading', { name: 'Run a lap' })).toBeInTheDocument();
    rerender({ runSucceeded: true });
    expect(await screen.findByText('You built it!')).toBeInTheDocument();
    await vi.waitFor(() => expect(client.rows[0]?.completedAt).not.toBeNull());
    expect(client.puts.at(-1)?.input).toMatchObject({
      completedSteps: ['intro', 'speed', 'run'],
      completed: true,
    });
    expect(client.rows[0]?.projectId).toBe('p1');

    // Resetting the run keeps the project complete.
    rerender({ runSucceeded: false });
    expect(screen.getByText('You built it!')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Parts list for the real robot' }));
    expect(props.onOpenParts).toHaveBeenCalled();
  });

  it('flags a completed step that was undone', async () => {
    localStorage.setItem(
      'robosim.guided.v1',
      JSON.stringify({ 'line-follower@1': { completedSteps: ['intro', 'speed'] } }),
    );
    await renderGuide({ doc: docWith() });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This step was done, but something has changed',
    );
    expect(screen.getByText('Wire IN1 of the L298N motor driver to the Arduino.')).toBeInTheDocument();
  });

  it('shows only a plans link for a project outside the plan', async () => {
    await renderGuide({ guided: { slug: 'obstacle-avoider', version: 1 } });
    expect(await screen.findByText(/part of the Maker plan/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See plans' })).toHaveAttribute('href', '/plans');
  });

  it('speaks Persian', async () => {
    localStorage.setItem(
      'robosim.guided.v1',
      JSON.stringify({ 'line-follower@1': { completedSteps: ['intro'] } }),
    );
    await renderGuide({ doc: docWith('D4') }, 'fa');
    expect(await screen.findByRole('heading', { name: 'پایهٔ سرعت روی PWM' })).toBeInTheDocument();
    expect(screen.getByText(/که PWM ندارد/)).toBeInTheDocument();
  });
});
