import { INVENTORY_MAX_ITEMS, type CatalogPriceList, type Inventory } from '@robosim/shared';
import { use, useCallback, useEffect, useRef, useState } from 'react';
import { AuthContext } from '../auth/use-auth.js';
import type { BomClient } from '../lib/bom-api.js';

/** Owned parts of a guest in this browser (FR-BOM-03); moved to the account on sign-in. */
const GUEST_KEY = 'robosim.inventory.v1';
export type Owned = Readonly<Record<string, number>>;

export function loadGuestOwned(): Owned {
  try {
    const raw = localStorage.getItem(GUEST_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, n]) => Number.isInteger(n) && (n as number) > 0),
    ) as Owned;
  } catch {
    return {};
  }
}

function saveGuestOwned(owned: Owned | null): void {
  try {
    if (owned && Object.keys(owned).length) localStorage.setItem(GUEST_KEY, JSON.stringify(owned));
    else localStorage.removeItem(GUEST_KEY);
  } catch {
    // storage disabled: the marks last for this visit
  }
}

const toInventory = (owned: Owned): Inventory => ({
  items: Object.entries(owned)
    .filter(([, n]) => n > 0)
    .slice(0, INVENTORY_MAX_ITEMS)
    .map(([partKey, quantity]) => ({ partKey, quantity })),
});
const fromInventory = (inv: Inventory): Owned =>
  Object.fromEntries(inv.items.map((i) => [i.partKey, i.quantity]));

/** Guest marks merged into the account's: the larger count wins, nothing owned is lost. */
export function mergeOwned(account: Owned, guest: Owned): Owned {
  const out: Record<string, number> = { ...account };
  for (const [k, n] of Object.entries(guest)) out[k] = Math.max(out[k] ?? 0, n);
  return out;
}

export interface BomData {
  readonly prices: CatalogPriceList | null;
  readonly pricesFailed: boolean;
  readonly owned: Owned;
  /** Sets how many of a part the user owns (0 removes it). */
  setOwned(key: string, quantity: number): void;
  readonly saveFailed: boolean;
}

/**
 * Prices (public) and owned parts for the parts list: the account's list when signed in, this browser's
 * otherwise. Changes are saved after a short pause so stepping a count does not send a request per click.
 */
export function useBomData(client: BomClient): BomData {
  const me = use(AuthContext)?.me ?? null;
  const [prices, setPrices] = useState<CatalogPriceList | null>(null);
  const [pricesFailed, setPricesFailed] = useState(false);
  const [owned, setOwnedState] = useState<Owned>(() => (me ? {} : loadGuestOwned()));
  const [saveFailed, setSaveFailed] = useState(false);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let live = true;
    client.prices().then(
      (p) => live && setPrices(p),
      () => live && setPricesFailed(true),
    );
    return () => {
      live = false;
    };
  }, [client]);

  const userId = me?.id ?? null;
  useEffect(() => {
    if (!userId) {
      setOwnedState(loadGuestOwned());
      return;
    }
    let live = true;
    void (async () => {
      try {
        const account = fromInventory(await client.inventory());
        const guest = loadGuestOwned();
        if (Object.keys(guest).length) {
          const merged = mergeOwned(account, guest);
          const saved = fromInventory(await client.setInventory(toInventory(merged)));
          saveGuestOwned(null);
          if (live) setOwnedState(saved);
        } else if (live) setOwnedState(account);
      } catch {
        if (live) setSaveFailed(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [client, userId]);

  const unsaved = useRef<Owned | null>(null);
  // Leaving the panel sends a change still waiting for its pause.
  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current);
      if (unsaved.current) void client.setInventory(toInventory(unsaved.current)).catch(() => undefined);
    },
    [client],
  );

  const ownedRef = useRef(owned);
  ownedRef.current = owned;
  const setOwned = useCallback(
    (key: string, quantity: number) => {
      const next: Record<string, number> = { ...ownedRef.current };
      if (quantity > 0) next[key] = Math.floor(quantity);
      else delete next[key];
      ownedRef.current = next;
      setOwnedState(next);
      if (!userId) return saveGuestOwned(next);
      if (pending.current) clearTimeout(pending.current);
      unsaved.current = next;
      pending.current = setTimeout(() => {
        pending.current = null;
        unsaved.current = null;
        client.setInventory(toInventory(next)).then(
          () => setSaveFailed(false),
          () => setSaveFailed(true),
        );
      }, 600);
    },
    [client, userId],
  );

  return { prices, pricesFailed, owned, setOwned, saveFailed };
}
