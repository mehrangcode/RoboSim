import type { ServerResponse } from 'node:http';
import {
  aiKeyScopeSchema,
  aiProviderIdSchema,
  chatRequestSchema,
  DomainError,
  isUuid,
  negotiateLocale,
  putAiKeyRequestSchema,
  updateAiProviderConfigSchema,
  type AiConversation,
  type AiConversationDetail,
  type AiKey,
  type AiModel,
  type AiProviderConfig,
  type AiProviderId,
  type AiUsage,
  type AiUsageReport,
  type UpdateAiProviderConfig,
} from '@robosim/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  type OnModuleDestroy,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { FixedWindowRateLimiter } from '../../common/rate-limiter.js';
import { ENV, type Env } from '../../config/env.js';
import {
  CallerGuard,
  CallerScope,
  requireStaff,
  StaffGuard,
  StaffScope,
  type Caller,
  type Staff,
} from '../iam/index.js';
import { AiService } from './ai.service.js';
import { AiProvidersService } from './providers.service.js';

const HEARTBEAT_MS = 15_000;

function providerParam(value: string): AiProviderId {
  const parsed = aiProviderIdSchema.safeParse(value);
  if (!parsed.success) throw new DomainError('not_found');
  return parsed.data;
}

function idParam(value: string): string {
  if (!isUuid(value)) throw new DomainError('not_found');
  return value;
}

/** AI assistant (API Spec §4.11; FR-AI-01…05, 07, 08). Signed-in users only: guests get a sign-in prompt. */
@Controller('ai')
@UseGuards(CallerGuard)
export class AiController implements OnModuleDestroy {
  private readonly perMinute: FixedWindowRateLimiter;
  private readonly perDay: FixedWindowRateLimiter;
  private readonly streams = new Set<ServerResponse>();

  constructor(
    private readonly ai: AiService,
    private readonly providers: AiProvidersService,
    @Inject(ENV) env: Env,
  ) {
    this.perMinute = new FixedWindowRateLimiter(env.AI_RATE_LIMIT_PER_MIN, 60_000);
    this.perDay = new FixedWindowRateLimiter(env.AI_RATE_LIMIT_PER_DAY, 86_400_000);
  }

  onModuleDestroy(): void {
    for (const s of this.streams) s.end();
  }

  @Get('providers')
  async list(
    @CallerScope() caller: Caller,
  ): Promise<{ providers: Awaited<ReturnType<AiProvidersService['list']>> }> {
    const policy = await this.providers.policy(caller, await this.ai.minor(caller));
    return { providers: await this.providers.list(caller, policy) };
  }

  @Put('keys/:provider')
  async putKey(
    @CallerScope() caller: Caller,
    @Param('provider') provider: string,
    @Body({ schema: putAiKeyRequestSchema }) body: z.output<typeof putAiKeyRequestSchema>,
  ): Promise<AiKey> {
    const policy = await this.providers.policy(caller, await this.ai.minor(caller));
    return this.providers.putKey(caller, policy, providerParam(provider), body);
  }

  @Delete('keys/:provider')
  @HttpCode(204)
  async deleteKey(
    @CallerScope() caller: Caller,
    @Param('provider') provider: string,
    @Query('scope') scope?: string,
  ): Promise<void> {
    const parsed = aiKeyScopeSchema.safeParse(scope ?? 'user');
    if (!parsed.success) throw new DomainError('validation_failed', { field: 'scope' });
    await this.providers.deleteKey(caller, providerParam(provider), parsed.data);
  }

  @Get('models')
  async models(
    @CallerScope() caller: Caller,
    @Query('provider') provider?: string,
  ): Promise<{ items: AiModel[] }> {
    const policy = await this.providers.policy(caller, await this.ai.minor(caller));
    return { items: await this.providers.models(caller, policy, providerParam(provider ?? 'platform')) };
  }

  @Get('usage')
  usage(@CallerScope() caller: Caller): Promise<AiUsage> {
    return this.ai.usage(caller);
  }

  @Get('conversations')
  async conversations(
    @CallerScope() caller: Caller,
    @Query('projectId') projectId?: string,
  ): Promise<{ items: AiConversation[] }> {
    return { items: await this.ai.list(caller, projectId ? idParam(projectId) : null) };
  }

  @Get('conversations/:id')
  conversation(@CallerScope() caller: Caller, @Param('id') id: string): Promise<AiConversationDetail> {
    return this.ai.get(caller, idParam(id));
  }

  @Delete('conversations/:id')
  @HttpCode(204)
  async deleteConversation(@CallerScope() caller: Caller, @Param('id') id: string): Promise<void> {
    await this.ai.remove(caller, idParam(id));
  }

  /**
   * SSE answer stream. Limits, entitlements, credits and validation are checked first, so refusals are regular
   * problem responses (`429 rate_limited` with `Retry-After`, `ai_credits_exhausted`, …); after the stream opens,
   * failures arrive as an `error` event.
   */
  @Post('chat')
  async chat(
    @CallerScope() caller: Caller,
    @Body({ schema: chatRequestSchema }) body: z.output<typeof chatRequestSchema>,
    @Headers('accept-language') acceptLanguage: string | undefined,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    for (const limiter of [this.perMinute, this.perDay]) {
      const rate = limiter.take(caller.userId);
      if (!rate.allowed) {
        void reply.header('Retry-After', String(rate.resetSeconds));
        throw new DomainError('rate_limited', { retryAfter: rate.resetSeconds });
      }
    }
    const prepared = await this.ai.prepare(caller, body, body.locale ?? negotiateLocale(acceptLanguage));

    void reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      'x-request-id': String(req.id),
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    });
    this.streams.add(raw);
    const gone = new AbortController();
    const heartbeat = setInterval(() => raw.write(': ping\n\n'), HEARTBEAT_MS);
    raw.on('close', () => gone.abort());
    try {
      let seq = 0;
      for await (const ev of this.ai.stream(prepared, gone.signal)) {
        if (raw.writableEnded) break;
        raw.write(`id: ${seq++}\nevent: ${ev.event}\ndata: ${JSON.stringify(ev.data)}\n\n`);
      }
    } finally {
      clearInterval(heartbeat);
      this.streams.delete(raw);
      if (!raw.writableEnded) raw.end();
    }
  }
}

/** Back office (FR-ADM-08): providers, models and usage. */
@Controller('admin/ai')
@UseGuards(StaffGuard)
export class AiAdminController {
  constructor(
    private readonly ai: AiService,
    private readonly providers: AiProvidersService,
  ) {}

  @Get('providers')
  async list(@StaffScope() staff: Staff): Promise<{ items: AiProviderConfig[] }> {
    requireStaff(staff, 'ai');
    return { items: await this.providers.adminList() };
  }

  @Put('providers/:provider')
  update(
    @StaffScope() staff: Staff,
    @Param('provider') provider: string,
    @Body({ schema: updateAiProviderConfigSchema }) body: UpdateAiProviderConfig,
  ): Promise<AiProviderConfig> {
    requireStaff(staff, 'ai');
    return this.providers.update(staff, providerParam(provider), body);
  }

  @Post('providers/:provider/check')
  @HttpCode(200)
  check(@StaffScope() staff: Staff, @Param('provider') provider: string): Promise<AiProviderConfig> {
    requireStaff(staff, 'ai');
    return this.providers.check(staff, providerParam(provider));
  }

  @Get('platform-models')
  async platformModels(@StaffScope() staff: Staff): Promise<{ items: AiModel[] }> {
    requireStaff(staff, 'ai');
    return { items: await this.providers.platformModels() };
  }

  @Get('usage')
  usage(@StaffScope() staff: Staff, @Query('days') days?: string): Promise<AiUsageReport> {
    requireStaff(staff, 'aiUsage');
    const n = Math.min(366, Math.max(1, Number.parseInt(days ?? '30', 10) || 30));
    const to = new Date();
    return this.ai.report(new Date(to.getTime() - n * 86_400_000), to);
  }
}
