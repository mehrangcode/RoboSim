import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/index.js';
import { OutboxModule } from '../outbox/index.js';
import { UsersService } from './users.service.js';

@Module({ imports: [AuditModule, OutboxModule], providers: [UsersService], exports: [UsersService] })
export class IamModule {}
