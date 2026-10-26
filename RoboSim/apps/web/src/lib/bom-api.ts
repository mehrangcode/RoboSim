import {
  catalogPriceListSchema,
  inventorySchema,
  type CatalogPriceList,
  type Inventory,
} from '@robosim/shared';
import { apiGet, apiSend } from './api.js';

/** Parts prices and owned parts (API Spec §4.3, §4.4); injectable so the parts list can be tested without HTTP. */
export interface BomClient {
  /** Public price list; empty until staff price parts. */
  prices(): Promise<CatalogPriceList>;
  /** The signed-in user's owned parts. */
  inventory(): Promise<Inventory>;
  setInventory(inventory: Inventory): Promise<Inventory>;
}

export function bomApi(locale: () => string): BomClient {
  return {
    prices: async () => catalogPriceListSchema.parse(await apiGet('/catalog/prices', locale())),
    inventory: async () => inventorySchema.parse(await apiGet('/me/inventory', locale())),
    setInventory: async (inventory) =>
      inventorySchema.parse(await apiSend('PUT', '/me/inventory', inventory, locale())),
  };
}
