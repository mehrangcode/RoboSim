import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/index.js';
import { OrgModule } from '../org/index.js';
import { OutboxModule } from '../outbox/index.js';
import { CallerGuard } from './caller.guard.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [AuditModule, OutboxModule, OrgModule],
  providers: [UsersService, CallerGuard],
  exports: [UsersService, CallerGuard, OrgModule],
})
export class IamModule {}
