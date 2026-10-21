import type { ServerResponse } from 'node:http';
import {
  buildRequestSchema,
  DomainError,
  isTerminalBuildState,
  isUuid,
  type BuildAccepted,
  type BuildRequest,
  type BuildResult,
  type BuildStatus,
} from '@robosim/shared';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Logger,
  type OnModuleDestroy,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ENV, type Env } from '../../config/env.js';
import { CallerGuard } from '../iam/index.js';
import { ProjectsService } from '../projects/index.js';
import { BUILDS_PATH, BuildGatewayService } from './build-gateway.service.js';
import type { BuildOwner } from './build-queue.js';
import { DailyBuildQuota } from './build-quota.js';
import { IdempotencyStore } from './idempotency.js';
import { FixedWindowRateLimiter } from '../../common/rate-limiter.js';

const HEARTBEAT_MS = 15_000;

/** The caller of a build route: a signed-in user, or a guest scoped by client address. */
interface BuildCaller extends BuildOwner {
  readonly guest: boolean;
}

type Created = { code: 200; body: BuildResult } | { code: 202; body: BuildAccepted };

@Controller()
export class BuildGatewayController implements OnModuleDestroy {
  private readonly logger = new Logger(BuildGatewayController.name);
  private readonly limiter: FixedWindowRateLimiter;
  private readonly guestLimiter: FixedWindowRateLimiter;
  private readonly quota: DailyBuildQuota;
  private readonly idempotency = new IdempotencyStore<Created>();
  private readonly streams = new Set<ServerResponse>();

  constructor(
    private readonly builds: BuildGatewayService,
    private readonly callers: CallerGuard,
    private readonly projects: ProjectsService,
    @Inject(ENV) env: Env,
  ) {
    this.limiter = new FixedWindowRateLimiter(env.BUILD_RATE_LIMIT_PER_MIN, 60_000);
    this.guestLimiter = new FixedWindowRateLimiter(env.BUILD_GUEST_RATE_LIMIT_PER_MIN, 60_000);
    this.quota = new DailyBuildQuota(env.BUILD_DAILY_QUOTA);
  }

  /**
   * API Spec §4.5: `200 BuildResult` when the sources are cached (a failed build is a result, not an error),
   * otherwise `202` with the queued job and `Location: /builds/:id`. Only queued builds count against the quota.
   */
  @Post('builds')
  @HttpCode(200)
  async create(
    @Body({ schema: buildRequestSchema }) body: BuildRequest,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<BuildResult | BuildAccepted> {
    const caller = await this.caller(req);
    const rate = (caller.guest ? this.guestLimiter : this.limiter).take(caller.userId);
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

    const created = await this.idempotency.run(caller.userId, key, body, async (): Promise<Created> => {
      const hit = await this.builds.cached(body);
      if (hit) {
        if (hit.status === 'succeeded' && hit.artifact) await this.snapshot(caller, body, hit.artifact.id);
        return { code: 200, body: hit };
      }
      const quota = this.quota.take(caller.userId);
      if (!quota.allowed) {
        const retryAfter = Math.max(1, Math.ceil((quota.resetAt.getTime() - Date.now()) / 1000));
        void reply.header('Retry-After', String(retryAfter));
        throw new DomainError('build_quota_exceeded', {
          limit: quota.limit,
          resetAt: quota.resetAt.toISOString(),
        });
      }
      const status = this.builds.submit(caller, body);
      if (body.projectId && !caller.guest)
        this.builds.onFinished(status.buildId, (final) => {
          if (final.state === 'succeeded' && final.result?.artifact)
            this.snapshot(caller, body, final.result.artifact.id).catch((e: unknown) =>
              this.logger.error(`auto version for build ${final.buildId} failed: ${(e as Error).message}`),
            );
        });
      return { code: 202, body: { ...status, ...this.links(status.buildId) } };
    });
    if (created.code === 202) {
      void reply.status(202);
      void reply.header('Location', created.body.statusUrl);
    }
    return created.body;
  }

  @Get('builds/:id')
  async status(@Param('id') id: string, @Req() req: FastifyRequest): Promise<BuildStatus> {
    const job = this.builds.status(id, await this.caller(req));
    if (!job) throw new DomainError('not_found');
    return job.status;
  }

  /**
   * SSE progress of a queued build (API Spec §4.5, §6): every event is named after the job state and carries the
   * full `BuildStatus`, with the job's event sequence as `id`. A (re)connection always starts with the current
   * status, so `Last-Event-ID` needs no replay buffer. The stream closes after the final event.
   */
  @Get('builds/:id/events')
  async events(
    @Param('id') id: string,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const job = this.builds.status(id, await this.caller(req));
    if (!job) throw new DomainError('not_found');

    void reply.hijack();
    const raw = reply.raw;
    // Hijacked replies skip the global onSend hook, so its headers are repeated here.
    raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      'x-request-id': String(req.id),
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    });
    raw.write('retry: 2000\n\n');
    this.streams.add(raw);

    let lastSeq = -1;
    let off = (): void => {};
    const heartbeat = setInterval(() => raw.write(': ping\n\n'), HEARTBEAT_MS);
    const close = (): void => {
      clearInterval(heartbeat);
      off();
      this.streams.delete(raw);
      if (!raw.writableEnded) raw.end();
    };
    const send = (status: BuildStatus, seq: number): void => {
      if (seq <= lastSeq || raw.writableEnded) return;
      lastSeq = seq;
      raw.write(`id: ${seq}\nevent: ${status.state}\ndata: ${JSON.stringify(status)}\n\n`);
      if (isTerminalBuildState(status.state)) close();
    };
    raw.on('close', close);
    off = this.builds.subscribe(id, send);
    send(job.status, job.seq);
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

  onModuleDestroy(): void {
    for (const raw of this.streams) raw.end();
    this.streams.clear();
  }

  private links(buildId: string): { statusUrl: string; eventsUrl: string } {
    return { statusUrl: `${BUILDS_PATH}/${buildId}`, eventsUrl: `${BUILDS_PATH}/${buildId}/events` };
  }

  /** Signed-in callers build as themselves; without an identity a guest is scoped by client address. */
  private async caller(req: FastifyRequest): Promise<BuildCaller> {
    try {
      return { ...(await this.callers.resolve(req)), guest: false };
    } catch (e) {
      if (!(e instanceof DomainError && e.code === 'unauthenticated')) throw e;
      const id = `guest:${req.ip}`;
      return { userId: id, workspaceId: id, guest: true };
    }
  }

  /** FR-PRJ-03: a successful build of a saved project becomes an automatic version. Guests have no projects. */
  private async snapshot(caller: BuildCaller, body: BuildRequest, artifactId: string): Promise<void> {
    if (caller.guest || !body.projectId) return;
    await this.projects.snapshotBuild(caller, body.projectId, body.files, artifactId);
  }
}
