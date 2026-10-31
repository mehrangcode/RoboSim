import { createMemoryHistory } from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from './app.js';
import { initI18n } from './lib/i18n.js';
import { ADMIN, FakeAdmin, SUPPORT, WORKSPACE_ID, problem } from './testing/fake-admin.js';

async function renderApp(path: string, client: FakeAdmin, locale: 'en' | 'fa' = 'en') {
  const i18n = await initI18n(locale);
  const history = createMemoryHistory({ initialEntries: [path] });
  render(<App i18n={i18n} history={history} client={client} />);
  return history;
}

describe('FR-ADM-01 staff session gate', () => {
  it('asks a signed-out visitor to sign in, then opens the back office', async () => {
    const client = new FakeAdmin(null);
    await renderApp('/', client);
    await userEvent.type(await screen.findByLabelText('Email'), 'ops@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong email or password');

    await userEvent.clear(screen.getByLabelText('Password'));
    await userEvent.type(screen.getByLabelText('Password'), 'staff pass 42');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Workspaces', level: 1 })).toBeInTheDocument();
    expect(screen.getByTestId('staff-name')).toHaveTextContent(ADMIN.displayName);
    expect(screen.getByText('Platform admin')).toBeInTheDocument();
    expect(client.callsTo('login').at(-1)).toEqual([{ email: 'ops@example.com', password: 'staff pass 42' }]);
  });

  it('tells a signed-in non-staff user there is no access and lets them sign out', async () => {
    const client = new FakeAdmin(null, problem('forbidden', 403));
    await renderApp('/plans', client);
    expect(await screen.findByRole('heading', { name: 'No back-office access' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Plans' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Back-office sign-in' })).toBeInTheDocument();
    expect(client.callsTo('logout')).toHaveLength(1);
  });

  it('signs staff out from the header', async () => {
    const client = new FakeAdmin();
    await renderApp('/workspaces', client);
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Back-office sign-in' })).toBeInTheDocument();
  });

  it('renders in Persian, right to left', async () => {
    await renderApp('/workspaces', new FakeAdmin(), 'fa');
    expect(await screen.findByRole('heading', { name: 'فضاهای کاری', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'ناوبری مدیریت' })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
  });
});

describe('FR-ADM-02 plans', () => {
  it('lists each plan with its current version and history', async () => {
    await renderApp('/plans', new FakeAdmin());
    const maker = await screen.findByRole('region', { name: /^Maker/ });
    expect(within(maker).getByText(/2,500,000 IRR/)).toBeInTheDocument();
    expect(within(maker).getByText(/42 subscribers/)).toBeInTheDocument();
    expect(within(maker).getByRole('heading', { name: 'Features' })).toBeInTheDocument();
    const free = screen.getByRole('region', { name: /^Free/ });
    expect(
      within(free).getByText(/Version 2 · Monthly · Price not set · 1,200 subscribers/),
    ).toBeInTheDocument();
    expect(within(free).getByText('Earlier versions (1)')).toBeInTheDocument();
  });

  it('publishes a new version after confirming the changes', async () => {
    const client = new FakeAdmin();
    await renderApp('/plans', client);
    const maker = await screen.findByRole('region', { name: /^Maker/ });
    await userEvent.click(within(maker).getByRole('button', { name: 'Publish new version' }));

    await userEvent.selectOptions(within(maker).getByLabelText('Billing interval'), 'year');
    const price = within(maker).getByLabelText('Price (IRR)');
    await userEvent.clear(price);
    await userEvent.type(price, '25000000');
    const builds = within(maker).getByLabelText('Builds per day');
    await userEvent.clear(builds);
    await userEvent.type(builds, '600');
    await userEvent.click(within(maker).getByLabelText('Real-time collaboration'));
    await userEvent.click(within(maker).getByRole('checkbox', { name: 'Unlimited Version history (days)' }));
    await userEvent.click(within(maker).getByRole('button', { name: 'Review changes' }));

    const changes = within(maker).getByRole('list', { name: 'Changes from the current version' });
    expect(
      within(changes)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      'Billing interval: Monthly → Yearly',
      'Price (IRR): 2,500,000 IRR → 25,000,000 IRR',
      'Real-time collaboration: Yes → No',
      'Version history (days): 365 → Unlimited',
      'Builds per day: 500 → 600',
    ]);
    expect(
      within(maker).getByText(/Current subscribers keep their version until their next renewal/),
    ).toBeInTheDocument();
    await userEvent.click(within(maker).getByRole('button', { name: 'Publish' }));

    expect(await within(maker).findByRole('status')).toHaveTextContent('Version 2 published.');
    const [[code, input]] = client.callsTo('publishPlanVersion') as [[string, Record<string, unknown>]];
    expect(code).toBe('maker');
    expect(input).toMatchObject({ interval: 'year', priceIrr: 25_000_000 });
    expect(input['entitlements']).toMatchObject({
      'build.daily_quota': 600,
      'collab.realtime': false,
      'projects.version_retention_days': null,
      'export.pdf': true,
    });
  });

  it('refuses invalid values before asking for confirmation', async () => {
    const client = new FakeAdmin();
    await renderApp('/plans', client);
    const free = await screen.findByRole('region', { name: /^Free/ });
    await userEvent.click(within(free).getByRole('button', { name: 'Publish new version' }));
    await userEvent.clear(within(free).getByLabelText('Cloud projects'));
    await userEvent.click(within(free).getByLabelText('Arduino Uno'));
    await userEvent.click(within(free).getByRole('button', { name: 'Review changes' }));
    expect(within(free).getByRole('alert')).toHaveTextContent('Some values are not valid');
    expect(within(free).getByLabelText('Cloud projects')).toHaveAttribute('aria-invalid', 'true');
    expect(client.callsTo('publishPlanVersion')).toHaveLength(0);
  });
});

describe('FR-ADM-06 workspaces', () => {
  it('searches, opens a workspace, changes its plan and grants and removes an override', async () => {
    const client = new FakeAdmin();
    const history = await renderApp('/workspaces', client);
    await userEvent.type(await screen.findByLabelText('Search workspaces'), 'sara@');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    const table = await screen.findByRole('table', { name: 'Workspaces matching sara@' });
    expect(within(table).getByText('sara@example.com')).toBeInTheDocument();
    expect(within(table).getByText('Free · Active')).toBeInTheDocument();
    expect(client.callsTo('searchWorkspaces')).toContainEqual(['sara@']);

    await userEvent.click(within(table).getByRole('link', { name: 'Sara’s robots' }));
    expect(await screen.findByRole('heading', { name: 'Sara’s robots', level: 1 })).toBeInTheDocument();
    expect(history.location.pathname).toBe(`/workspaces/${WORKSPACE_ID}`);
    expect(screen.getByText('2 live projects')).toBeInTheDocument();

    // Change plan
    await userEvent.click(screen.getByRole('button', { name: 'Change plan' }));
    const planForm = screen.getByRole('form', { name: 'Change plan' });
    await userEvent.selectOptions(within(planForm).getByLabelText('Plan'), 'maker');
    await userEvent.type(within(planForm).getByLabelText('End date (optional)'), '2027-01-31');
    await userEvent.click(within(planForm).getByRole('button', { name: 'Save plan' }));
    expect(within(planForm).getByRole('alert')).toHaveTextContent('Give a reason');
    await userEvent.type(within(planForm).getByLabelText('Reason'), 'Paid by bank transfer');
    await userEvent.click(within(planForm).getByRole('button', { name: 'Save plan' }));
    expect(await screen.findByText('Plan updated.')).toBeInTheDocument();
    expect(client.callsTo('setSubscription')).toEqual([
      [
        WORKSPACE_ID,
        { plan: 'maker', periodEnd: '2027-01-31T23:59:59+03:30', reason: 'Paid by bank transfer' },
      ],
    ]);
    expect(screen.getByText(/Maker \(version 1\)/)).toBeInTheDocument();

    // Grant override
    await userEvent.click(screen.getByRole('button', { name: 'Grant override' }));
    const grantForm = screen.getByRole('form', { name: 'Grant override' });
    await userEvent.selectOptions(within(grantForm).getByLabelText('Entitlement'), 'build.daily_quota');
    const value = within(grantForm).getByLabelText('Value');
    await userEvent.clear(value);
    await userEvent.type(value, '100');
    await userEvent.selectOptions(within(grantForm).getByLabelText('Applies to'), 'owner');
    await userEvent.type(within(grantForm).getByLabelText('Reason'), 'Robotics contest week');
    await userEvent.click(within(grantForm).getByRole('button', { name: 'Grant' }));
    expect(await screen.findByText('Override granted.')).toBeInTheDocument();
    expect(client.callsTo('grantOverride')).toEqual([
      [
        WORKSPACE_ID,
        {
          key: 'build.daily_quota',
          value: 100,
          reason: 'Robotics contest week',
          expiresAt: null,
          userId: '01920000-0000-7000-8000-000000000001',
        },
      ],
    ]);
    const overrides = screen.getByRole('region', { name: 'Overrides' });
    expect(within(overrides).getByText('Member: Sara')).toBeInTheDocument();
    expect(within(overrides).getByText('Never')).toBeInTheDocument();
    // Maker's 500 builds plus the 100 granted.
    const effective = screen.getByRole('region', { name: 'Effective entitlements' });
    expect(within(effective).getByText('600')).toBeInTheDocument();

    // Remove it (two steps)
    await userEvent.click(within(overrides).getByRole('button', { name: 'Remove override Builds per day' }));
    await userEvent.click(within(overrides).getByRole('button', { name: 'Confirm removal' }));
    expect(await screen.findByText('Override removed.')).toBeInTheDocument();
    expect(client.callsTo('removeOverride')).toEqual([[WORKSPACE_ID, 'ov-1']]);
    expect(within(overrides).getByText('No overrides.')).toBeInTheDocument();
  });

  it('shows an API error when a workspace cannot be loaded', async () => {
    await renderApp('/workspaces/nope', new FakeAdmin());
    expect(await screen.findByRole('alert')).toHaveTextContent('Workspace not found');
  });
});

describe('Security §4.4 permissions in the UI', () => {
  it('hides plan and subscription actions from a support agent but lets them grant overrides', async () => {
    const client = new FakeAdmin(SUPPORT);
    await renderApp('/plans', client);
    await screen.findByRole('region', { name: /^Maker/ });
    expect(screen.queryByRole('button', { name: 'Publish new version' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'Workspaces' }));
    await userEvent.click(await screen.findByRole('link', { name: 'Sara’s robots' }));
    await screen.findByRole('heading', { name: 'Sara’s robots', level: 1 });
    expect(screen.queryByRole('button', { name: 'Change plan' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Grant override' })).toBeInTheDocument();
  });
});

describe('FR-BOM-02 parts prices', () => {
  it('lists parts, sets a price and a variant price, and removes one', async () => {
    const client = new FakeAdmin();
    await renderApp('/prices', client);
    expect(await screen.findByRole('heading', { name: 'Parts prices', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Prices' })).toBeInTheDocument();
    const l298n = (await screen.findByText('L298N motor driver')).closest('tr');
    if (!l298n) throw new Error('no L298N row');
    expect(within(l298n).getByText('1,850,000 IRR')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Edit price of Arduino Uno' }));
    await userEvent.type(screen.getByLabelText('Unit price (IRR)'), '12.5');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a whole number of rials');
    await userEvent.clear(screen.getByLabelText('Unit price (IRR)'));
    await userEvent.type(screen.getByLabelText('Unit price (IRR)'), '9500000');
    await userEvent.selectOptions(screen.getByLabelText('Stock'), 'low');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('9,500,000 IRR')).toBeInTheDocument();
    expect(client.callsTo('setPrice').at(-1)).toEqual([
      'board:avr-uno',
      { priceIrr: 9_500_000, stock: 'low' },
    ]);

    await userEvent.click(screen.getByRole('button', { name: 'Add variant price' }));
    await userEvent.type(screen.getByLabelText('ohms'), '220');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.type(screen.getByLabelText('Unit price (IRR)'), '5000');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('ohms=220')).toBeInTheDocument();
    expect(client.callsTo('setPrice').at(-1)).toEqual([
      'passive.resistor?ohms=220',
      { priceIrr: 5_000, stock: 'in_stock' },
    ]);

    await userEvent.click(screen.getByRole('button', { name: 'Remove price of L298N motor driver' }));
    expect(client.callsTo('removePrice')).toEqual([['driver.l298n']]);
  });

  it('hides the prices link from staff without the permission', async () => {
    await renderApp('/plans', new FakeAdmin(SUPPORT));
    expect(await screen.findByRole('link', { name: 'Plans' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Prices' })).not.toBeInTheDocument();
  });
});

describe('FR-ADM-08 AI assistant', () => {
  it('enables a provider only with a legal reference and shows usage', async () => {
    const client = new FakeAdmin();
    await renderApp('/ai', client);
    expect(await screen.findByRole('heading', { name: 'AI assistant', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'AI' })).toBeInTheDocument();
    expect(await screen.findByText('qwen2.5:3b', { selector: 'td' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Edit OpenAI' }));
    await userEvent.click(screen.getByLabelText('Enabled for this deployment'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter the legal review reference');
    await userEvent.type(screen.getByLabelText('Legal review reference'), 'LEGAL-14');
    await userEvent.type(screen.getByLabelText('Default model'), 'gpt-x');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/legal review LEGAL-14/)).toBeInTheDocument();
    expect(client.callsTo('updateAiProvider').at(-1)).toEqual([
      'openai',
      expect.objectContaining({ enabled: true, legalRef: 'LEGAL-14', defaultModel: 'gpt-x' }),
    ]);

    await userEvent.selectOptions(screen.getByLabelText('Period'), '7');
    expect(client.callsTo('aiUsage').at(-1)).toEqual([7]);
  });

  it('hides the AI link from support staff', async () => {
    await renderApp('/plans', new FakeAdmin(SUPPORT));
    expect(await screen.findByRole('link', { name: 'Plans' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'AI' })).not.toBeInTheDocument();
  });
});
