import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ENV, type Env } from '../../config/env.js';
import { AuditModule } from '../audit/index.js';
import { OrgModule } from '../org/index.js';
import { OutboxModule } from '../outbox/index.js';
import { AuthController, DevMailController, MeController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { CallerGuard } from './caller.guard.js';
import { CsrfGuard } from './csrf.guard.js';
import { DevMailSink, MAILER } from './mailer.js';
import { SessionsService } from './sessions.service.js';
import { StaffGuard } from './staff.guard.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [AuditModule, OutboxModule, OrgModule],
  controllers: [AuthController, MeController, DevMailController],
  providers: [
    UsersService,
    SessionsService,
    AuthService,
    CallerGuard,
    StaffGuard,
    { provide: APP_GUARD, useClass: CsrfGuard },
    // `MAIL_TRANSPORT` has only `dev` until the SMTP adapter lands with staging (refused there by env checks).
    { provide: MAILER, inject: [ENV], useFactory: (_env: Env) => new DevMailSink() },
  ],
  exports: [UsersService, SessionsService, CallerGuard, StaffGuard, OrgModule, MAILER],
})
export class IamModule {}
