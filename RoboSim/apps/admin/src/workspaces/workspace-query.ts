import type { AdminWorkspace } from '@robosim/shared';
import { useQueryClient } from '@tanstack/react-query';

export const workspaceKey = (id: string) => ['admin', 'workspace', id] as const;

/** Stores a workspace the API returned after a change, and refreshes search results that may show it. */
export function useWorkspaceUpdated(id: string) {
  const queryClient = useQueryClient();
  return (ws: AdminWorkspace) => {
    queryClient.setQueryData(workspaceKey(id), ws);
    void queryClient.invalidateQueries({ queryKey: ['admin', 'workspaces'] });
  };
}
