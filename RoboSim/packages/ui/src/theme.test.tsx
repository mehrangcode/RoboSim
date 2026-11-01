import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { THEME_STORAGE_KEY, applyStoredTheme, readThemePreference, setThemePreference, useTheme } from './theme.js';

function Probe() {
  const { preference, resolved } = useTheme();
  return <p>{`${preference}:${resolved}`}</p>;
}

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe('theme preference', () => {
  it('defaults to system with no data-theme', () => {
    expect(readThemePreference()).toBe('system');
    applyStoredTheme();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('stamps and remembers an explicit choice, and clears it for system', () => {
    setThemePreference('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    setThemePreference('system');
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('ignores a corrupt saved value', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'neon');
    expect(readThemePreference()).toBe('system');
  });

  it('re-renders subscribers when the preference changes', () => {
    render(<Probe />);
    expect(screen.getByText(/^system:/)).toBeInTheDocument();
    act(() => setThemePreference('dark'));
    expect(screen.getByText('dark:dark')).toBeInTheDocument();
    act(() => setThemePreference('light'));
    expect(screen.getByText('light:light')).toBeInTheDocument();
  });
});
