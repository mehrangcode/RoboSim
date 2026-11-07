import { useEffect, useState } from 'react';
import type { AiClient } from './ai-api.js';

/**
 * Whether the signed-in user can ask the AI now (a provider is `usable`: entitlement, credits, key).
 * False while signed out, loading or on error, so offline features never wait on it (FR-CIR-12).
 */
export function useAiUsable(client: Pick<AiClient, 'providers'>, signedIn: boolean): boolean {
  const [usable, setUsable] = useState<{ client: Pick<AiClient, 'providers'>; value: boolean } | null>(null);
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    client.providers().then(
      (list) => live && setUsable({ client, value: list.some((p) => p.usable) }),
      () => live && setUsable({ client, value: false }),
    );
    return () => {
      live = false;
    };
  }, [client, signedIn]);
  return signedIn && usable?.client === client ? usable.value : false;
}
