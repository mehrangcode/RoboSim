import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/auth-context.js';
import { initI18n } from '../lib/i18n.js';
import { FakeAuth, problem, SARA } from '../testing/fake-auth.js';
import { FakeEntitlements, planError } from '../testing/fake-entitlements.js';
import { paywallReason } from './paywall-reason.js';
import { PlanUsageCard } from './plan-usage.js';
import { PlansPage } from './plans-page.js';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

async function show(ui: ReactNode, lang: 'en' | 'fa' = 'en', signedIn = true) {
  const i18n = await initI18n(lang);
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider client={new FakeAuth(signedIn ? SARA : undefined)}>{ui}</AuthProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

describe('paywallReason', () => {
  it('maps plan refusals and ignores other errors', () => {
    expect(paywallReason(planError('quota_exceeded', { quota: 'projects.cloud_max', limit: 3 }))).toEqual({
      kind: 'cloudMax',
      limit: 3,
    });
    expect(
      paywallReason(planError('quota_exceeded', { quota: 'projects.cloud_max', limit: 3, locked: true })),
    ).toEqual({ kind: 'locked', limit: 3 });
    expect(
      paywallReason(planError('entitlement_required', { entitlement: 'components.tier', parts: ['a', 1] })),
    ).toEqual({ kind: 'parts', parts: ['a'] });
    expect(paywallReason(planError('entitlement_required', { entitlement: 'export.pdf' }))).toEqual({
      kind: 'feature',
    });
    expect(paywallReason(planError('build_quota_exceeded', { limit: 30, resetAt: 'x' }))).toEqual({
      kind: 'builds',
      limit: 30,
      resetAt: 'x',
    });
    expect(paywallReason(planError('quota_exceeded', { limit: 500 }))).toBeNull();
    expect(paywallReason(problem('forbidden', 403))).toBeNull();
    expect(paywallReason(new Error('offline'))).toBeNull();
  });
});

describe('plans page (FR-BIL-05)', () => {
  it('compares Free and Maker, marks the current plan, and holds checkout until payments', async () => {
    await show(<PlansPage entitlements={new FakeEntitlements()} />);
    const free = await screen.findByRole('region', { name: /Free/ });
    const maker = screen.getByRole('region', { name: 'Maker' });
    expect(await within(free).findByText('Your plan')).toBeInTheDocument();
    expect(within(free).getByText('Cloud projects').nextSibling).toHaveTextContent('3');
    expect(within(maker).getByText('Cloud projects').nextSibling).toHaveTextContent('Unlimited');
    expect(within(free).getByText('Basic parts')).toBeInTheDocument();
    expect(within(maker).getByText('All parts, including Pro')).toBeInTheDocument();
    expect(within(maker).getByText('2,500,000 rials per month')).toBeInTheDocument();
    expect(within(maker).getByRole('button', { name: 'Upgrade to Maker' })).toBeDisabled();
    expect(within(maker).getByText('Payments are coming soon.')).toBeInTheDocument();
  });

  it('works signed out and in Persian', async () => {
    await show(<PlansPage entitlements={new FakeEntitlements()} />, 'fa', false);
    expect(await screen.findByRole('heading', { name: 'میکر' })).toBeInTheDocument();
    expect(screen.queryByText('پلن شما')).toBeNull();
  });
});

describe('account plan & usage', () => {
  it('shows the plan, cloud projects and builds against their limits', async () => {
    const entitlements = new FakeEntitlements();
    entitlements.projectsUsed = 2;
    entitlements.buildsUsed = 12;
    await show(<PlanUsageCard entitlements={entitlements} />);
    expect(await screen.findByText('Free plan')).toBeInTheDocument();
    expect(screen.getByText('2 of 3 cloud projects')).toBeInTheDocument();
    expect(screen.getByText('12 of 30 builds today')).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'Builds a day' })).toHaveAttribute('value', '12');
    expect(screen.getByRole('link', { name: 'Compare plans' })).toHaveAttribute('href', '/plans');
  });
});
