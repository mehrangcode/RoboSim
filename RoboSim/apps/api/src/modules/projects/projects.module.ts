import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/index.js';
import { IamModule } from '../iam/index.js';
import { OutboxModule } from '../outbox/index.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';
import { SharedLinkController } from './shared-link.controller.js';
import { SharingService } from './sharing.service.js';

@Module({
  imports: [AuditModule, OutboxModule, IamModule],
  controllers: [ProjectsController, SharedLinkController],
  providers: [ProjectsService, SharingService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
