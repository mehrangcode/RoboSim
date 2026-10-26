import { type DynamicModule, Global, Module } from '@nestjs/common';
import { ENV, type Env } from './config/env.js';
import { DATABASE, type Database } from './db/client.js';
import { AuditModule } from './modules/audit/index.js';
import { BomModule } from './modules/bom/index.js';
import { LearningModule } from './modules/learning/index.js';
import { BuildGatewayModule } from './modules/build-gateway/index.js';
import { EntitlementsModule } from './modules/entitlements/index.js';
import { FeatureFlagsModule } from './modules/feature-flags/index.js';
import { HealthModule } from './modules/health/health.module.js';
import { IamModule } from './modules/iam/index.js';
import { OrgModule } from './modules/org/index.js';
import { OutboxModule } from './modules/outbox/index.js';
import { ProjectsModule } from './modules/projects/index.js';

@Global()
@Module({})
class InfrastructureModule {
  static register(env: Env, database: Database): DynamicModule {
    return {
      module: InfrastructureModule,
      providers: [
        { provide: ENV, useValue: env },
        { provide: DATABASE, useValue: database },
      ],
      exports: [ENV, DATABASE],
    };
  }
}

@Module({})
export class AppModule {
  static register(env: Env, database: Database): DynamicModule {
    return {
      module: AppModule,
      imports: [
        InfrastructureModule.register(env, database),
        HealthModule,
        FeatureFlagsModule,
        AuditModule,
        OutboxModule,
        IamModule,
        OrgModule,
        EntitlementsModule,
        BuildGatewayModule,
        ProjectsModule,
        BomModule,
        LearningModule,
      ],
    };
  }
}
