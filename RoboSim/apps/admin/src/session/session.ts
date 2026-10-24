import { staffCan, type AdminPermission, type StaffMe } from '@robosim/shared';
import { createContext, use } from 'react';
import type { AdminClient } from '../lib/admin-api.js';

export const ME_KEY = ['admin', 'me'] as const;

export const ClientContext = createContext<AdminClient | null>(null);
export const StaffContext = createContext<StaffMe | null>(null);

export function useClient(): AdminClient {
  const client = use(ClientContext);
  if (!client) throw new Error('useClient outside <ClientContext>');
  return client;
}

/** The signed-in staff member; only usable below the session gate. */
export function useStaff(): StaffMe {
  const staff = use(StaffContext);
  if (!staff) throw new Error('useStaff outside the session gate');
  return staff;
}

/** Whether the staff member may do `permission` (the API enforces it too). */
export function useCan(permission: AdminPermission): boolean {
  return staffCan(useStaff().roles, permission);
}
