import type { CatalogPriceList, Inventory } from '@robosim/shared';
import type { BomClient } from '../lib/bom-api.js';

/** In-memory price list and owned parts; calls are recorded. */
export class FakeBom implements BomClient {
  priceList: CatalogPriceList = {
    items: [
      {
        partKey: 'board:avr-uno',
        priceIrr: 9_500_000,
        stock: 'in_stock',
        updatedAt: '2026-10-20T08:00:00.000Z',
      },
      { partKey: 'actuator.led', priceIrr: 20_000, stock: 'low', updatedAt: '2026-10-21T08:00:00.000Z' },
    ],
    asOf: '2026-10-21T08:00:00.000Z',
  };
  owned: Inventory = { items: [] };
  readonly saved: Inventory[] = [];

  prices = () => Promise.resolve(this.priceList);
  inventory = () => Promise.resolve(this.owned);
  setInventory = (inventory: Inventory) => {
    this.saved.push(inventory);
    this.owned = inventory;
    return Promise.resolve(inventory);
  };
}
