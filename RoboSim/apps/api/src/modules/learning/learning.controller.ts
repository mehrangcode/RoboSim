import {
  DomainError,
  contentVersionIdSchema,
  putGuidedProgressSchema,
  type GuidedProgress,
  type GuidedProjectResponse,
  type GuidedSummary,
  type PutGuidedProgressInput,
} from '@robosim/shared';
import { Body, Controller, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CallerGuard, CallerScope, type Caller } from '../iam/index.js';
import { LearningService } from './learning.service.js';

/** API Spec §4.6: guided projects (public, shaped by the caller's plan) and the caller's progress. */
@Controller()
export class LearningController {
  constructor(
    private readonly learning: LearningService,
    private readonly callers: CallerGuard,
  ) {}

  @Get('guided-projects')
  async list(@Req() req: FastifyRequest): Promise<GuidedSummary[]> {
    return this.learning.list(await this.caller(req));
  }

  @Get('guided-projects/:slug')
  async get(@Req() req: FastifyRequest, @Param('slug') slug: string): Promise<GuidedProjectResponse> {
    return this.learning.get(await this.caller(req), slug);
  }

  @Get('progress/guided')
  @UseGuards(CallerGuard)
  progress(@CallerScope() caller: Caller): Promise<GuidedProgress[]> {
    return this.learning.progress(caller);
  }

  @Put('progress/guided/:contentVersionId')
  @UseGuards(CallerGuard)
  putProgress(
    @CallerScope() caller: Caller,
    @Param('contentVersionId') versionId: string,
    @Body({ schema: putGuidedProgressSchema }) body: PutGuidedProgressInput,
  ): Promise<GuidedProgress> {
    if (!contentVersionIdSchema.safeParse(versionId).success)
      throw new DomainError('validation_failed', { field: 'contentVersionId' });
    return this.learning.putProgress(caller, versionId, body);
  }

  /** Signed-in callers see their plan's projects; guests see Free's. */
  private async caller(req: FastifyRequest): Promise<Caller | null> {
    try {
      return await this.callers.resolve(req);
    } catch (e) {
      if (e instanceof DomainError && e.code === 'unauthenticated') return null;
      throw e;
    }
  }
}
