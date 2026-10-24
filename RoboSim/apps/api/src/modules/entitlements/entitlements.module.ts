import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/index.js';
import { IamModule } from '../iam/index.js';
import { OutboxModule } from '../outbox/index.js';
import { BillingAdminService } from './billing-admin.service.js';
import { BillingAdminController, EntitlementsController } from './entitlements.controller.js';
import { EntitlementsService } from './entitlements.service.js';
import { QuotaService } from './quota.service.js';

/** Plans, subscriptions, overrides and the entitlements every enforcement point asks (TD §7.1 `entitlements`). */
@Module({
  imports: [AuditModule, OutboxModule, IamModule],
  controllers: [EntitlementsController, BillingAdminController],
  providers: [EntitlementsService, QuotaService, BillingAdminService],
  exports: [EntitlementsService, QuotaService],
})
export class EntitlementsModule {}
