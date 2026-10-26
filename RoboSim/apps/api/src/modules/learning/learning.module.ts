import { Module } from '@nestjs/common';
import { EntitlementsModule } from '../entitlements/index.js';
import { IamModule } from '../iam/index.js';
import { LearningController } from './learning.controller.js';
import { LearningService } from './learning.service.js';

/** Guided projects and learners' progress (FR-LRN-01). Courses and classes join it in P3. */
@Module({
  imports: [IamModule, EntitlementsModule],
  controllers: [LearningController],
  providers: [LearningService],
})
export class LearningModule {}
