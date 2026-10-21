import type { Me } from '@robosim/shared';
import { createContext, use } from 'react';
import type { AuthClient } from '../lib/auth-api.js';

export interface AuthState {
  /** `undefined` while the first check runs, `null` when signed out. */
  readonly me: Me | null | undefined;
  readonly client: AuthClient;
  /** Records a sign-in or profile change, and drops data cached for the previous user. */
  setMe(me: Me | null): void;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const state = use(AuthContext);
  if (!state) throw new Error('useAuth needs an <AuthProvider>');
  return state;
}

/** Only same-site paths survive as a post-sign-in destination (no open redirect). */
export function safeRedirect(value: unknown): string | undefined {
  return typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.includes('\\')
    ? value
    : undefined;
}
