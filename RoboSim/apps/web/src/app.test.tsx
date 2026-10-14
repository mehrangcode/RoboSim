import { createMemoryHistory } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './app.js';
import { initI18n } from './lib/i18n.js';

async function renderApp(locale: 'en' | 'fa', path = '/') {
  const i18n = await initI18n(locale);
  render(<App i18n={i18n} history={createMemoryHistory({ initialEntries: [path] })} />);
  return i18n;
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 })),
  );
});

describe('US-I18N-01 Persian RTL shell', () => {
  it('AC1 renders Persian with RTL document direction', async () => {
    await renderApp('fa');
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('اول مجازی بساز');
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(document.documentElement).toHaveAttribute('lang', 'fa');
  });

  it('switching language flips direction and persists the choice', async () => {
    await renderApp('en');
    expect(document.documentElement).toHaveAttribute('dir', 'ltr');
    await userEvent.click(await screen.findByRole('radio', { name: 'فارسی' }));
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('اول مجازی بساز');
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(localStorage.getItem('robosim.locale')).toBe('fa');
  });

  it('shows platform status from the API', async () => {
    await renderApp('en');
    expect(await screen.findByText('Connected to the RoboSim platform.')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/health/ready',
      expect.objectContaining({ headers: expect.objectContaining({ 'Accept-Language': 'en' }) }),
    );
  });

  it('reports an unreachable server without losing the page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network down');
      }),
    );
    await renderApp('fa');
    expect(
      await screen.findByText('در حال حاضر دسترسی به سرور ممکن نیست. کارهای محلی شما محفوظ است.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'تلاش دوباره' })).toBeInTheDocument();
  });

  it('renders a localized not-found page', async () => {
    await renderApp('fa', '/does-not-exist');
    expect(await screen.findByRole('heading', { name: 'صفحه پیدا نشد' })).toBeInTheDocument();
  });
});
