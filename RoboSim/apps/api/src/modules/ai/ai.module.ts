import { Module } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import { AuditModule } from '../audit/index.js';
import { EntitlementsModule } from '../entitlements/index.js';
import { IamModule } from '../iam/index.js';
import { ProjectsModule } from '../projects/index.js';
import { AiAdminController, AiController } from './ai.controller.js';
import { AiService } from './ai.service.js';
import { KEY_WRAPPER, LocalKeyWrapper } from './key-vault.js';
import { AiProvidersService, defaultProviderFactory, PROVIDER_FACTORY } from './providers.service.js';

/** AI assistant (FR-AI-01…05, 07…09, FR-ADM-08; Technical Design §13). */
@Module({
  imports: [AuditModule, IamModule, EntitlementsModule, ProjectsModule],
  controllers: [AiController, AiAdminController],
  providers: [
    AiService,
    AiProvidersService,
    { provide: KEY_WRAPPER, inject: [ENV], useFactory: (env: Env) => new LocalKeyWrapper(env.AI_KEK) },
    {
      provide: PROVIDER_FACTORY,
      inject: [ENV],
      useFactory: (env: Env) => ({ create: defaultProviderFactory(env) }),
    },
  ],
  exports: [AiService],
})
export class AiModule {}
