import { DomainError, projectEtag, shareTokenSchema, type Project, type SharedLink } from '@robosim/shared';
import { Controller, Get, Inject, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { FixedWindowRateLimiter } from '../../common/rate-limiter.js';
import { ENV, type Env } from '../../config/env.js';
import { CallerGuard, CallerScope, type Caller } from '../iam/index.js';
import { SharingService } from './sharing.service.js';

/** Share links (US-PRJ-03): anyone with the link can open the project; remixing needs an account. */
@Controller('shared')
export class SharedLinkController {
  /** Link guessing is hopeless (256-bit tokens), but lookups still cost a query: cap them per address. */
  private readonly limiter: FixedWindowRateLimiter;

  constructor(
    private readonly sharing: SharingService,
    @Inject(ENV) env: Env,
  ) {
    this.limiter = new FixedWindowRateLimiter(env.SHARED_LINK_RATE_LIMIT_PER_MIN, 60_000);
  }

  @Get(':token')
  open(
    @Param('token') token: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SharedLink> {
    this.throttle(req, reply);
    return this.sharing.open(checked(token));
  }

  @Post(':token/remix')
  @UseGuards(CallerGuard)
  async remix(
    @CallerScope() caller: Caller,
    @Param('token') token: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Project> {
    const project = await this.sharing.remix(caller, checked(token));
    void reply.status(201).header('etag', projectEtag(project.revision));
    return project;
  }

  private throttle(req: FastifyRequest, reply: FastifyReply): void {
    const rate = this.limiter.take(`ip:${req.ip}`);
    if (!rate.allowed) {
      void reply.header('Retry-After', String(rate.resetSeconds));
      throw new DomainError('rate_limited');
    }
  }
}

function checked(token: string): string {
  if (!shareTokenSchema.safeParse(token).success) throw new DomainError('not_found');
  return token;
}
