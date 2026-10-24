import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/use-auth.js';
import { entitlementsApi, type EntitlementsClient } from '../lib/entitlements-api.js';

/** A stable entitlements client, the injected one in tests. */
export function useEntitlementsClient(injected?: EntitlementsClient): EntitlementsClient {
  const { i18n } = useTranslation();
  const [fallback] = useState(() => entitlementsApi(() => i18n.language));
  return injected ?? fallback;
}

/** The signed-in caller's plan and usage (`GET /me/entitlements`); idle while signed out. */
export function useEntitlements(injected?: EntitlementsClient) {
  const client = useEntitlementsClient(injected);
  const { me } = useAuth();
  return useQuery({
    queryKey: ['entitlements', me?.id],
    queryFn: () => client.me(),
    enabled: !!me,
    retry: false,
  });
}
