import { Module } from '@nestjs/common';
import { WorkspacesService } from './workspaces.service.js';

@Module({ providers: [WorkspacesService], exports: [WorkspacesService] })
export class OrgModule {}
