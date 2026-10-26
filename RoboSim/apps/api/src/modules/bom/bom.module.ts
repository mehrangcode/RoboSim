import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/index.js';
import { IamModule } from '../iam/index.js';
import { BomController, PricesAdminController } from './bom.controller.js';
import { BomService } from './bom.service.js';

/** Parts price list and owned-parts inventories behind the BOM (FR-BOM-02, FR-BOM-03). */
@Module({
  imports: [AuditModule, IamModule],
  controllers: [BomController, PricesAdminController],
  providers: [BomService],
})
export class BomModule {}
