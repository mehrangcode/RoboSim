import type { Me } from '@robosim/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { authApi, type AuthClient } from '../lib/auth-api.js';
import { AuthContext } from './use-auth.js';

const ME_KEY = ['auth', 'me'] as const;

/** Who is signed in, from `GET /me`; a network failure counts as signed out so pages still render. */
export function AuthProvider({ client: injected, children }: { client?: AuthClient; children: ReactNode }) {
  const { i18n } = useTranslation();
  const [fallback] = useState(() => authApi(() => i18n.language));
  const client = injected ?? fallback;
  const queryClient = useQueryClient();
  const me = useQuery({
    queryKey: ME_KEY,
    queryFn: () => client.me().catch(() => null),
    retry: false,
    staleTime: 60_000,
  });
  const setMe = (next: Me | null) => {
    const previous = queryClient.getQueryData<Me | null>(ME_KEY);
    if (previous?.id !== next?.id) queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' });
    queryClient.setQueryData(ME_KEY, next);
  };
  return <AuthContext value={{ me: me.data, client, setMe }}>{children}</AuthContext>;
}
