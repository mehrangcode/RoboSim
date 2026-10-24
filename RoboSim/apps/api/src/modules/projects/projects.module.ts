import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/index.js';
import { EntitlementsModule } from '../entitlements/index.js';
import { IamModule } from '../iam/index.js';
import { OutboxModule } from '../outbox/index.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectLimits } from './project-limits.service.js';
import { ProjectsService } from './projects.service.js';
import { SharedLinkController } from './shared-link.controller.js';
import { SharingService } from './sharing.service.js';
import { VersionRetention } from './version-retention.service.js';

@Module({
  imports: [AuditModule, OutboxModule, IamModule, EntitlementsModule],
  controllers: [ProjectsController, SharedLinkController],
  providers: [ProjectsService, SharingService, ProjectLimits, VersionRetention],
  exports: [ProjectsService, VersionRetention],
})
export class ProjectsModule {}
