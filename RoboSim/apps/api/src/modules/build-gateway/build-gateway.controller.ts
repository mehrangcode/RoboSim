import {
  buildRequestSchema,
  DomainError,
  isUuid,
  type BuildRequest,
  type BuildResult,
} from '@robosim/shared';
import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ENV, type Env } from '../../config/env.js';
import { BuildGatewayService } from './build-gateway.service.js';
import { IdempotencyStore } from './idempotency.js';
import { FixedWindowRateLimiter } from './rate-limiter.js';

@Controller()
export class BuildGatewayController {
  private readonly limiter: FixedWindowRateLimiter;
  private readonly idempotency = new IdempotencyStore<BuildResult>();

  constructor(
    private readonly builds: BuildGatewayService,
    @Inject(ENV) env: Env,
  ) {
    this.limiter = new FixedWindowRateLimiter(env.BUILD_RATE_LIMIT_PER_MIN, 60_000);
  }

  /** API Spec §4.5. Synchronous for now: always `200 BuildResult` (a failed build is a result, not an error). */
  @Post('builds')
  @HttpCode(200)
  async create(
    @Body({ schema: buildRequestSchema }) body: BuildRequest,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<BuildResult> {
    // Until sessions land (P2) the client address is the rate-limit and idempotency scope.
    const client = req.ip;
    const rate = this.limiter.take(client);
    void reply.header('RateLimit-Limit', String(rate.limit));
    void reply.header('RateLimit-Remaining', String(rate.remaining));
    void reply.header('RateLimit-Reset', String(rate.resetSeconds));
    if (!rate.allowed) {
      void reply.header('Retry-After', String(rate.resetSeconds));
      throw new DomainError('rate_limited');
    }
    if (!key || !isUuid(key))
      throw new DomainError('validation_failed', {
        errors: [{ path: 'Idempotency-Key', message: 'a UUID Idempotency-Key header is required' }],
      });
    return this.idempotency.run(client, key, body, () => this.builds.build(body));
  }

  /** Firmware by content address; immutable, so cacheable forever. */
  @Get('artifacts/:id')
  async artifact(@Param('id') id: string, @Res({ passthrough: true }) reply: FastifyReply): Promise<string> {
    const hex = await this.builds.artifact(id);
    if (hex === undefined) throw new DomainError('not_found');
    void reply.header('content-type', 'text/plain; charset=utf-8');
    void reply.header('cache-control', 'public, max-age=31536000, immutable');
    return hex;
  }
}
