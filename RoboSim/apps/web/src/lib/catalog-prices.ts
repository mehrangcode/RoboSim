import { baseKeyOf, catalogPriceListSchema, type CatalogPriceList } from '@robosim/shared';
import { useEffect, useState } from 'react';
import type { BomClient } from './bom-api.js';

/** Last price list seen, so the library chips and the BOM still show prices offline (TD §18.6). */
export const PRICE_CACHE_KEY = 'robosim.catalogPrices.v1';

type PriceClient = Pick<BomClient, 'prices'>;

// One request per client per page load, shared by the BOM and the library.
const loads = new WeakMap<PriceClient, Promise<CatalogPriceList>>();

export function cachedCatalogPrices(): CatalogPriceList | null {
  try {
    const raw = localStorage.getItem(PRICE_CACHE_KEY);
    if (!raw) return null;
    const parsed = catalogPriceListSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Fetches the public price list once; on failure falls back to the cached list, else rejects. */
export function loadCatalogPrices(client: PriceClient): Promise<CatalogPriceList> {
  let load = loads.get(client);
  if (!load) {
    load = client.prices().then(
      (list) => {
        try {
          localStorage.setItem(PRICE_CACHE_KEY, JSON.stringify(list));
        } catch {
          // Storage full or blocked: prices still show for this page load.
        }
        return list;
      },
      (error: unknown) => {
        loads.delete(client);
        const cached = cachedCatalogPrices();
        if (cached) return cached;
        throw error;
      },
    );
    loads.set(client, load);
  }
  return load;
}

export function useCatalogPrices(client: PriceClient): { prices: CatalogPriceList | null; failed: boolean } {
  const [state, setState] = useState<{ prices: CatalogPriceList | null; failed: boolean }>({
    prices: null,
    failed: false,
  });
  useEffect(() => {
    let live = true;
    loadCatalogPrices(client).then(
      (prices) => live && setState({ prices, failed: false }),
      () => live && setState({ prices: null, failed: true }),
    );
    return () => {
      live = false;
    };
  }, [client]);
  return state;
}

/**
 * Unit price of a part type in rials: its own row, else the cheapest priced variant (a resistor's
 * values); null when unpriced, never 0 for "unknown".
 */
export function priceOfType(list: CatalogPriceList | null, type: string): number | null {
  if (!list) return null;
  let best: number | null = null;
  for (const item of list.items) {
    if (item.priceIrr === null) continue;
    if (item.partKey === type) return item.priceIrr;
    if (baseKeyOf(item.partKey) === type && (best === null || item.priceIrr < best)) best = item.priceIrr;
  }
  return best;
}
