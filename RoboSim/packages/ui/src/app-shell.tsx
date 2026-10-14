import type { ReactNode } from 'react';

export interface AppShellProps {
  brand: ReactNode;
  /** Accessible label of the main navigation landmark. */
  navLabel: string;
  nav?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}

/** Page frame: header with brand, navigation and actions; main landmark. Mirrors automatically in RTL. */
export function AppShell({ brand, navLabel, nav, actions, children }: AppShellProps) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-14 items-center gap-6 border-b border-line bg-surface-raised px-4">
        <div className="flex items-center gap-2 font-semibold">{brand}</div>
        <nav aria-label={navLabel} className="flex flex-1 items-center gap-4 text-sm">
          {nav}
        </nav>
        <div className="flex items-center gap-3">{actions}</div>
      </header>
      <main id="main" className="flex-1 p-6">
        {children}
      </main>
    </div>
  );
}
