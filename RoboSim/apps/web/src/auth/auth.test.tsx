import { createMemoryHistory } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../app.js';
import { initI18n } from '../lib/i18n.js';
import { FakeAuth, SARA } from '../testing/fake-auth.js';
import { safeRedirect } from './use-auth.js';

async function renderApp(path: string, auth: FakeAuth, locale: 'en' | 'fa' = 'en') {
  const i18n = await initI18n(locale);
  const history = createMemoryHistory({ initialEntries: [path] });
  render(<App i18n={i18n} history={history} auth={auth} />);
  return history;
}

beforeEach(() => {
  // Anything not served by the fake auth client (health, projects) answers like a signed-out API.
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            type: 'x',
            title: 'You need to sign in',
            status: 401,
            code: 'unauthenticated',
            requestId: 'r',
          }),
          { status: 401, headers: { 'content-type': 'application/problem+json' } },
        ),
    ),
  );
});

describe('sign-in (FR-IAM-01)', () => {
  it('signs in and returns to the page that asked for it', async () => {
    const auth = new FakeAuth();
    const history = await renderApp('/login?redirect=%2Faccount', auth);
    await userEvent.type(await screen.findByLabelText('Email'), SARA.email ?? '');
    await userEvent.type(screen.getByLabelText('Password'), 'green lamp 42');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Your account' })).toBeInTheDocument();
    expect(history.location.pathname).toBe('/account');
    expect(screen.getByRole('button', { name: 'Account' })).toHaveTextContent('Sara');
  });

  it('shows the API error and stays on the form', async () => {
    const auth = new FakeAuth();
    await renderApp('/login', auth);
    await userEvent.type(await screen.findByLabelText('Email'), SARA.email ?? '');
    await userEvent.type(screen.getByLabelText('Password'), 'not the password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid_credentials');
  });

  it('never redirects off-site', () => {
    expect(safeRedirect('/projects?x=1')).toBe('/projects?x=1');
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', 42, undefined])
      expect(safeRedirect(bad)).toBeUndefined();
  });

  it('signs out from the account menu', async () => {
    const auth = new FakeAuth(SARA);
    await renderApp('/', auth);
    await userEvent.click(await screen.findByRole('button', { name: 'Account' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeInTheDocument();
    expect(auth.calls.map((c) => c.method)).toContain('logout');
  });
});

describe('sign-up (FR-IAM-01)', () => {
  it('explains a password-policy rejection in Persian', async () => {
    const auth = new FakeAuth();
    await renderApp('/register', auth, 'fa');
    await userEvent.type(await screen.findByLabelText('نام شما'), 'سارا');
    await userEvent.type(screen.getByLabelText('ایمیل'), 'sara@example.com');
    await userEvent.type(screen.getByLabelText('رمز عبور'), 'Password123');
    await userEvent.type(screen.getByLabelText('تاریخ تولد'), '1999-03-21');
    await userEvent.click(screen.getByRole('button', { name: 'ساخت حساب' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('این رمز عبور بسیار رایج است');
    expect(auth.calls[0]?.args[0]).toMatchObject({ locale: 'fa', dateOfBirth: '1999-03-21' });
  });

  it('signs the new user in and asks them to verify their email', async () => {
    const auth = new FakeAuth();
    await renderApp('/register?redirect=%2Faccount', auth);
    await userEvent.type(await screen.findByLabelText('Your name'), 'Sara');
    await userEvent.type(screen.getByLabelText('Email'), 'new@example.com');
    await userEvent.type(screen.getByLabelText(/^Password/), 'green lamp 42');
    await userEvent.type(screen.getByLabelText('Date of birth'), '1999-03-21');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText(/Please verify new@example.com/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send it again' }));
    expect(await screen.findByText('A new link was sent.')).toBeInTheDocument();
  });
});

describe('emailed links', () => {
  it('verifies the email from the link', async () => {
    const auth = new FakeAuth({ ...SARA, emailVerified: false });
    await renderApp('/verify-email?token=good-token-0123456789', auth);
    expect(await screen.findByText('Your email is verified. Thank you!')).toBeInTheDocument();
    expect(auth.calls.filter((c) => c.method === 'verifyEmail')).toHaveLength(1);
  });

  it('reports a used or expired verification link', async () => {
    await renderApp('/verify-email?token=used-token-0123456789', new FakeAuth());
    expect(await screen.findByRole('alert')).toHaveTextContent('expired or was already used');
  });

  it('sets a new password from a reset link and asks to sign in again', async () => {
    const auth = new FakeAuth();
    await renderApp('/reset-password?token=reset-token-0123456789', auth);
    await userEvent.type(await screen.findByLabelText(/^New password/), 'blue kettle 77');
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }));
    expect(await screen.findByText(/signed out everywhere/)).toBeInTheDocument();
    expect(auth.password).toBe('blue kettle 77');
  });

  it('never says whether an email has an account', async () => {
    const auth = new FakeAuth();
    await renderApp('/forgot-password', auth);
    await userEvent.type(await screen.findByLabelText('Email'), 'ghost@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('status')).toHaveTextContent('If an account uses ghost@example.com');
  });
});

describe('account (FR-IAM-03, US-IAM-02 AC2)', () => {
  it('lists sessions and signs out another device', async () => {
    const auth = new FakeAuth(SARA);
    await renderApp('/account', auth);
    expect(await screen.findByText('Chrome on Android')).toBeInTheDocument();
    expect(screen.getByText('This browser')).toBeInTheDocument();
    const [, other] = screen.getAllByRole('button', { name: 'Sign out' });
    if (!other) throw new Error('expected two sessions');
    await userEvent.click(other);
    await waitFor(() => expect(screen.queryByText('Chrome on Android')).not.toBeInTheDocument());
    expect(auth.calls.find((c) => c.method === 'revokeSession')?.args[0]).toBe(
      '01920000-0000-7000-8000-0000000000a2',
    );
  });

  it('changes the password with the current one', async () => {
    const auth = new FakeAuth(SARA);
    await renderApp('/account', auth);
    await userEvent.type(await screen.findByLabelText('Current password'), 'green lamp 42');
    await userEvent.type(screen.getByLabelText(/^New password/), 'blue kettle 77');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText(/Password changed/)).toBeInTheDocument();
  });

  it('switches the interface language with the profile', async () => {
    const auth = new FakeAuth(SARA);
    await renderApp('/account', auth);
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Language' }), 'fa');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('heading', { name: 'حساب کاربری شما' })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
  });

  it('asks a signed-out visitor to sign in, for the account and for cloud projects', async () => {
    await renderApp('/account', new FakeAuth());
    expect(await screen.findByRole('heading', { name: 'Sign in to continue' })).toBeInTheDocument();
  });

  it('gates the projects page when the API says unauthenticated', async () => {
    await renderApp('/projects', new FakeAuth());
    expect(
      await screen.findByRole('heading', { name: 'Sign in to continue' }, { timeout: 10_000 }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Sign in' })[1]).toHaveAttribute(
      'href',
      '/login?redirect=%2Fprojects',
    );
  });
});
