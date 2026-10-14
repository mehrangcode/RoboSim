import { describe, expect, it } from 'vitest';
import { directionOf, negotiateLocale } from './locale.js';

describe('FR-I18N-01 locale negotiation', () => {
  it.each([
    ['fa-IR,fa;q=0.9,en;q=0.8', 'fa'],
    ['en-US,en;q=0.9', 'en'],
    ['de-DE,fa;q=0.5', 'fa'],
    ['de-DE', 'en'],
    [undefined, 'en'],
    ['', 'en'],
  ])('%s → %s', (header, expected) => expect(negotiateLocale(header)).toBe(expected));

  it('honours q-values over order', () => {
    expect(negotiateLocale('en;q=0.4,fa;q=0.9')).toBe('fa');
  });

  it('FR-I18N-02 maps Persian to RTL', () => {
    expect(directionOf('fa')).toBe('rtl');
    expect(directionOf('en')).toBe('ltr');
  });
});
