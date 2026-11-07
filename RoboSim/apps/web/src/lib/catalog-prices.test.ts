import type { CatalogPriceList } from '@robosim/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cachedCatalogPrices, loadCatalogPrices, PRICE_CACHE_KEY, priceOfType } from './catalog-prices.js';

const LIST: CatalogPriceList = {
  asOf: '2026-11-01T00:00:00Z',
  items: [
    { partKey: 'sensor.hc-sr04', priceIrr: 950_000, stock: 'in_stock', updatedAt: '2026-11-01T00:00:00Z' },
    {
      partKey: 'passive.resistor?ohms=220',
      priceIrr: 5_000,
      stock: 'in_stock',
      updatedAt: '2026-11-01T00:00:00Z',
    },
    {
      partKey: 'passive.resistor?ohms=10000',
      priceIrr: 4_000,
      stock: 'low',
      updatedAt: '2026-11-01T00:00:00Z',
    },
    { partKey: 'driver.l298n', priceIrr: null, stock: 'unknown', updatedAt: '2026-11-01T00:00:00Z' },
  ],
};

afterEach(() => localStorage.clear());

describe('catalogue prices (TD §18.6)', () => {
  it('one request per client, shared by every caller, cached for offline use', async () => {
    const client = { prices: vi.fn(async () => LIST) };
    const [a, b] = await Promise.all([loadCatalogPrices(client), loadCatalogPrices(client)]);
    expect(a).toBe(b);
    expect(client.prices).toHaveBeenCalledTimes(1);
    expect(cachedCatalogPrices()).toEqual(LIST);
  });

  it('offline: falls back to the last cached list, else fails', async () => {
    const offline = { prices: vi.fn(() => Promise.reject(new Error('offline'))) };
    await expect(loadCatalogPrices(offline)).rejects.toThrow('offline');
    localStorage.setItem(PRICE_CACHE_KEY, JSON.stringify(LIST));
    await expect(loadCatalogPrices(offline)).resolves.toEqual(LIST);
    localStorage.setItem(PRICE_CACHE_KEY, '{"broken":');
    expect(cachedCatalogPrices()).toBeNull();
  });

  it('a type is priced by its own row or its cheapest variant; unpriced is null, never 0', () => {
    expect(priceOfType(LIST, 'sensor.hc-sr04')).toBe(950_000);
    expect(priceOfType(LIST, 'passive.resistor')).toBe(4_000);
    expect(priceOfType(LIST, 'driver.l298n')).toBeNull();
    expect(priceOfType(LIST, 'sensor.pir')).toBeNull();
    expect(priceOfType(null, 'sensor.hc-sr04')).toBeNull();
  });
});
