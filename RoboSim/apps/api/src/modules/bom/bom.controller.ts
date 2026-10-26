import {
  DomainError,
  inventorySchema,
  partKeySchema,
  upsertCatalogPriceSchema,
  type AdminPriceList,
  type CatalogPrice,
  type CatalogPriceList,
  type Inventory,
  type UpsertCatalogPriceInput,
} from '@robosim/shared';
import { Body, Controller, Delete, Get, HttpCode, Param, Put, UseGuards } from '@nestjs/common';
import {
  CallerGuard,
  CallerScope,
  requireStaff,
  StaffGuard,
  StaffScope,
  type Caller,
  type Staff,
} from '../iam/index.js';
import { BomService } from './bom.service.js';

function keyParam(value: string): string {
  if (!partKeySchema.safeParse(value).success)
    throw new DomainError('validation_failed', { field: 'partKey' });
  return value;
}

/** API Spec §4.3, §4.4: the parts price list (public) and the caller's owned parts. */
@Controller()
export class BomController {
  constructor(private readonly bom: BomService) {}

  @Get('catalog/prices')
  prices(): Promise<CatalogPriceList> {
    return this.bom.prices();
  }

  @Get('me/inventory')
  @UseGuards(CallerGuard)
  inventory(@CallerScope() caller: Caller): Promise<Inventory> {
    return this.bom.inventory(caller.userId);
  }

  @Put('me/inventory')
  @UseGuards(CallerGuard)
  setInventory(
    @CallerScope() caller: Caller,
    @Body({ schema: inventorySchema }) body: Inventory,
  ): Promise<Inventory> {
    return this.bom.setInventory(caller.userId, body);
  }
}

/** Back office (API Spec §4.13): the price list behind the BOM. */
@Controller('admin/catalog/prices')
@UseGuards(StaffGuard)
export class PricesAdminController {
  constructor(private readonly bom: BomService) {}

  @Get()
  list(@StaffScope() staff: Staff): Promise<AdminPriceList> {
    requireStaff(staff, 'prices');
    return this.bom.adminPrices();
  }

  @Put(':partKey')
  set(
    @StaffScope() staff: Staff,
    @Param('partKey') partKey: string,
    @Body({ schema: upsertCatalogPriceSchema }) body: UpsertCatalogPriceInput,
  ): Promise<CatalogPrice> {
    requireStaff(staff, 'prices');
    return this.bom.setPrice(staff, keyParam(partKey), body);
  }

  @Delete(':partKey')
  @HttpCode(204)
  async remove(@StaffScope() staff: Staff, @Param('partKey') partKey: string): Promise<void> {
    requireStaff(staff, 'prices');
    await this.bom.removePrice(staff, keyParam(partKey));
  }
}
