import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './app.js';
import { initI18n } from './lib/i18n.js';

describe('FR-ADM-01 admin shell', () => {
  it('renders in Persian with RTL direction', async () => {
    render(<App i18n={await initI18n('fa')} />);
    expect(await screen.findByRole('heading', { name: 'پنل مدیریت' })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
  });

  it('renders in English', async () => {
    render(<App i18n={await initI18n('en')} />);
    expect(await screen.findByRole('navigation', { name: 'Admin navigation' })).toBeInTheDocument();
  });
});
