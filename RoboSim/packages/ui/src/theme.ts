import { useSyncExternalStore } from 'react';

export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ResolvedTheme = Exclude<ThemePreference, 'system'>;

/** Also read by the inline pre-paint script in each app's index.html; keep them in sync. */
export const THEME_STORAGE_KEY = 'robosim.theme';
const CHANGE_EVENT = 'robosim:themechange';
const DARK_QUERY = '(prefers-color-scheme: dark)';

function isPreference(value: unknown): value is ThemePreference {
  return (THEME_PREFERENCES as readonly unknown[]).includes(value);
}

/** Saved choice on this device, or `system` when none (or storage is unavailable). */
export function readThemePreference(win: Window = window): ThemePreference {
  try {
    const saved = win.localStorage.getItem(THEME_STORAGE_KEY);
    return isPreference(saved) ? saved : 'system';
  } catch {
    return 'system';
  }
}

function systemTheme(win: Window): ResolvedTheme {
  return typeof win.matchMedia === 'function' && win.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

export function resolveTheme(preference: ThemePreference, win: Window = window): ResolvedTheme {
  return preference === 'system' ? systemTheme(win) : preference;
}

/**
 * Stamps `<html data-theme>` (absent = follow the OS) so the token blocks in styles.css apply,
 * and remembers the choice per device.
 */
export function setThemePreference(preference: ThemePreference, win: Window = window): void {
  const root = win.document.documentElement;
  if (preference === 'system') delete root.dataset.theme;
  else root.dataset.theme = preference;
  try {
    if (preference === 'system') win.localStorage.removeItem(THEME_STORAGE_KEY);
    else win.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Non-fatal: the choice applies to this page but is not remembered.
  }
  win.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Stamps the saved preference without persisting or notifying; used at startup and for other tabs. */
export function applyStoredTheme(win: Window = window): void {
  const preference = readThemePreference(win);
  const root = win.document.documentElement;
  if (preference === 'system') delete root.dataset.theme;
  else root.dataset.theme = preference;
}

function subscribe(onChange: () => void): () => void {
  const media = typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : null;
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
    applyStoredTheme();
    onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  media?.addEventListener('change', onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
    media?.removeEventListener('change', onChange);
  };
}

/** Current preference plus the effective theme, updating on user choice, other tabs and OS changes. */
export function useTheme() {
  const preference = useSyncExternalStore(
    subscribe,
    () => readThemePreference(),
    () => 'system' as const,
  );
  const resolved = useSyncExternalStore(
    subscribe,
    () => resolveTheme(preference),
    () => 'light' as const,
  );
  return { preference, resolved, setPreference: setThemePreference };
}
