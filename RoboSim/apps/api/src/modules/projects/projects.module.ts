import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/index.js';
import { IamModule } from '../iam/index.js';
import { OutboxModule } from '../outbox/index.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';

@Module({
  imports: [AuditModule, OutboxModule, IamModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
