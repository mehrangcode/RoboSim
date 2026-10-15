import { useCallback, useState, useSyncExternalStore } from 'react';

/** Pane sizes (px) and collapsed panes of the workspace, saved in this browser (FR-WRK-01). */
export interface Layout {
  readonly left: number;
  readonly code: number;
  readonly sim: number;
  readonly dock: number;
  readonly collapsed: Readonly<Record<Pane, boolean>>;
}
export type Pane = 'left' | 'code' | 'sim' | 'dock';

const KEY = 'robosim.editor.layout.v1';
export const DEFAULT_LAYOUT: Layout = {
  left: 240,
  code: 420,
  sim: 300,
  dock: 220,
  collapsed: { left: false, code: false, sim: false, dock: false },
};

function load(): Layout {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Layout> | null;
    if (!saved) return DEFAULT_LAYOUT;
    const n = (k: 'left' | 'code' | 'sim' | 'dock') =>
      typeof saved[k] === 'number' && Number.isFinite(saved[k]) ? saved[k] : DEFAULT_LAYOUT[k];
    return {
      left: n('left'),
      code: n('code'),
      sim: n('sim'),
      dock: n('dock'),
      collapsed: { ...DEFAULT_LAYOUT.collapsed, ...(saved.collapsed ?? {}) },
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function persist(layout: Layout): Layout {
  try {
    localStorage.setItem(KEY, JSON.stringify(layout));
  } catch {
    // Not persisted; the layout still applies for this visit.
  }
  return layout;
}

export function useLayout() {
  const [layout, setLayout] = useState<Layout>(load);
  const resize = useCallback(
    (change: Partial<Omit<Layout, 'collapsed'>>) => setLayout((l) => persist({ ...l, ...change })),
    [],
  );
  const toggle = useCallback(
    (pane: Pane) =>
      setLayout((l) => persist({ ...l, collapsed: { ...l.collapsed, [pane]: !l.collapsed[pane] } })),
    [],
  );
  return { layout, resize, toggle };
}

/** Workspace size class (FR-WRK-03): panes ≥ 1024 px, tabs below, view-and-run only below 768 px. */
export type SizeClass = 'wide' | 'medium' | 'narrow';

function sizeClass(): SizeClass {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'wide';
  if (window.matchMedia('(min-width: 1024px)').matches) return 'wide';
  return window.matchMedia('(min-width: 768px)').matches ? 'medium' : 'narrow';
}

function subscribe(onChange: () => void) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const queries = ['(min-width: 1024px)', '(min-width: 768px)'].map((q) => window.matchMedia(q));
  for (const q of queries) q.addEventListener('change', onChange);
  return () => {
    for (const q of queries) q.removeEventListener('change', onChange);
  };
}

export function useSizeClass(): SizeClass {
  return useSyncExternalStore(subscribe, sizeClass, () => 'wide');
}
