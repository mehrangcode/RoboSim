import { staffCan, type StaffMe } from '@robosim/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../lib/api.js';
import { ME_KEY, useClient } from './session.js';

export type SessionState =
  | { kind: 'loading' }
  | { kind: 'signedOut' }
  | { kind: 'forbidden' }
  | { kind: 'error'; error: unknown; retry: () => void }
  | { kind: 'staff'; me: StaffMe };

/** Who is using the back office, from `GET /admin/me` (401 signed out, 403 not staff). */
export function useSession(): SessionState {
  const client = useClient();
  const me = useQuery({ queryKey: ME_KEY, queryFn: () => client.me(), retry: false, staleTime: 60_000 });
  if (me.data)
    return staffCan(me.data.roles, 'read') ? { kind: 'staff', me: me.data } : { kind: 'forbidden' };
  if (me.error) {
    const status = me.error instanceof ApiError ? me.error.problem.status : 0;
    if (status === 401) return { kind: 'signedOut' };
    if (status === 403) return { kind: 'forbidden' };
    return { kind: 'error', error: me.error, retry: () => void me.refetch() };
  }
  return { kind: 'loading' };
}

/** Ends the session and drops everything cached for it; the gate then shows the sign-in form. */
export function useSignOut() {
  const client = useClient();
  const queryClient = useQueryClient();
  return async () => {
    try {
      await client.logout();
    } finally {
      queryClient.removeQueries({ predicate: (q) => q.queryKey[1] !== ME_KEY[1] });
      await queryClient.resetQueries({ queryKey: ME_KEY });
    }
  };
}
