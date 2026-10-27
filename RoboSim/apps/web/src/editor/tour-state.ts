import { use, useCallback, useState } from 'react';
import { AuthContext } from '../auth/use-auth.js';

/** Stops of the editor tour (FR-WRK-06); each points at the element marked `data-tour="<id>"`, if shown. */
export const TOUR_STOPS = ['welcome', 'parts', 'circuit', 'code', 'run', 'monitor', 'help'] as const;
export type TourStop = (typeof TOUR_STOPS)[number];

const STORAGE_KEY = 'robosim.editor.tourDone';

function doneLocally(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return true; // No storage: never nag on every visit.
  }
}

/**
 * Whether the tour opens by itself (first visit) and how to mark it done: per account on the server
 * for signed-in users (every device), per browser for guests.
 */
export function useTourState() {
  // Without an auth provider (embedded or test workspaces) the browser flag alone decides.
  const auth = use(AuthContext);
  const me = auth ? auth.me : null;
  const [local, setLocal] = useState(doneLocally);
  const decided = me !== undefined;
  const done = local || (me ? me.editorTourCompletedAt !== null : false);
  const complete = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    } catch {
      // Storage blocked: the account flag (if signed in) still records it.
    }
    setLocal(true);
    if (auth && me && me.editorTourCompletedAt === null)
      void auth.client.updateMe({ editorTourCompleted: true }).then(auth.setMe, () => undefined);
  }, [auth, me]);
  return { autoOpen: decided && !done, complete };
}
