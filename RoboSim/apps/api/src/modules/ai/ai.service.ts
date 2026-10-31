import { ProviderError, type ChatChunk } from '@robosim/ai-providers';
import {
  DomainError,
  parseProjectDocument,
  ProjectDocumentError,
  type AiConversation,
  type AiConversationDetail,
  type AiMessage,
  type AiProposal,
  type AiProviderId,
  type AiUsage,
  type AiUsageReport,
  type ChatEvent,
  type Locale,
  type ProjectDocument,
  type chatRequestSchema,
  uuidv7,
} from '@robosim/shared';
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { and, asc, desc, eq, gt, gte, isNull, lt, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { ENV, type Env } from '../../config/env.js';
import { DATABASE, type Database } from '../../db/client.js';
import { aiConversations, aiMessages, aiUsage, users } from '../../db/schema.js';
import { withScope, withSystem } from '../../db/scope.js';
import { EntitlementsService } from '../entitlements/index.js';
import type { Caller } from '../iam/index.js';
import { ProjectsService } from '../projects/index.js';
import { checkContent, FILTERED_NOTICE } from './output-filter.js';
import { buildPrompt, TOOLS } from './prompt.js';
import { PART_TYPES, PARTS, toProposal } from './proposals.js';
import { AiProvidersService, type ResolvedProvider } from './providers.service.js';

type ParsedChat = z.output<typeof chatRequestSchema>;

/** Everything checked and loaded before the stream opens: failures here are ordinary problem responses. */
export interface PreparedChat {
  caller: Caller;
  locale: Locale;
  minor: boolean;
  resolved: ResolvedProvider;
  conversationId: string;
  isNew: boolean;
  projectId: string | null;
  title: string;
  message: string;
  document: ProjectDocument | null;
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  promptTokens: number;
  remaining: number | null;
  mode: 'full' | 'hints';
}

/** Tehran has had no daylight saving since 2022: months start at 00:00 +03:30. */
const TEHRAN_OFFSET_MS = 3.5 * 3_600_000;
export function creditMonth(now: Date): { start: Date; end: Date } {
  const local = new Date(now.getTime() + TEHRAN_OFFSET_MS);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  return {
    start: new Date(Date.UTC(y, m, 1) - TEHRAN_OFFSET_MS),
    end: new Date(Date.UTC(y, m + 1, 1) - TEHRAN_OFFSET_MS),
  };
}

const days = (n: number): number => n * 86_400_000;

@Injectable()
export class AiService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiService.name);
  private purgeTimer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly providers: AiProvidersService,
    private readonly entitlements: EntitlementsService,
    private readonly projects: ProjectsService,
  ) {}

  onModuleInit(): void {
    if (this.env.APP_ENV === 'test') return;
    this.purgeTimer = setInterval(() => {
      this.purgeExpired().catch((e: unknown) =>
        this.logger.error(`AI history purge failed: ${(e as Error).message}`),
      );
    }, 3_600_000);
    this.purgeTimer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.purgeTimer);
  }

  /** Conversations past their retention (FR-AI-08) are deleted with their messages. */
  async purgeExpired(now: Date = new Date()): Promise<number> {
    const gone = await withSystem(this.database.db, (tx) =>
      tx
        .delete(aiConversations)
        .where(lt(aiConversations.expiresAt, now))
        .returning({ id: aiConversations.id }),
    );
    return gone.length;
  }

  async minor(caller: Caller): Promise<boolean> {
    const [row] = await withSystem(this.database.db, (tx) =>
      tx.select({ ageBand: users.ageBand }).from(users).where(eq(users.id, caller.userId)),
    );
    return (row?.ageBand ?? 'adult') !== 'adult';
  }

  private historyDays(minor: boolean): number {
    return minor ? this.env.AI_HISTORY_DAYS_MINOR : this.env.AI_HISTORY_DAYS;
  }

  private async monthUsed(caller: Caller, now: Date): Promise<number> {
    const { start } = creditMonth(now);
    const [row] = await withScope(this.database.db, caller, (tx) =>
      tx
        .select({ used: sql<number>`coalesce(sum(${aiUsage.credits}), 0)::int` })
        .from(aiUsage)
        .where(
          and(
            eq(aiUsage.userId, caller.userId),
            eq(aiUsage.workspaceId, caller.workspaceId),
            gte(aiUsage.createdAt, start),
          ),
        ),
    );
    return row?.used ?? 0;
  }

  async usage(caller: Caller, now: Date = new Date()): Promise<AiUsage> {
    const [{ values }, used, minor] = await Promise.all([
      this.entitlements.resolve(caller.workspaceId, caller.userId),
      this.monthUsed(caller, now),
      this.minor(caller),
    ]);
    const allowance = values['ai.platform_credits_monthly'];
    return {
      allowance,
      used,
      remaining: allowance === null ? null : Math.max(0, allowance - used),
      resetsAt: creditMonth(now).end.toISOString(),
      rateLimit: { perMinute: this.env.AI_RATE_LIMIT_PER_MIN, perDay: this.env.AI_RATE_LIMIT_PER_DAY },
      historyDays: this.historyDays(minor),
    };
  }

  async prepare(caller: Caller, body: ParsedChat, locale: Locale): Promise<PreparedChat> {
    const now = new Date();
    const minor = await this.minor(caller);
    const blocked = checkContent(body.message, { minor });
    if (blocked)
      throw new DomainError('policy_restricted', { reason: 'content_filtered', category: blocked });

    const policy = await this.providers.policy(caller, minor);
    const resolved = await this.providers.resolve(caller, policy, body.provider, body.model);

    let remaining: number | null = null;
    if (resolved.platform) {
      const usage = await this.usage(caller, now);
      remaining = usage.remaining;
      if (remaining !== null && remaining <= 0) {
        throw new DomainError('ai_credits_exhausted', {
          allowance: usage.allowance,
          resetAt: usage.resetsAt,
          suggestedPlan: 'maker',
        });
      }
    }

    if (body.projectId) await this.projects.get(caller, body.projectId);

    let document: ProjectDocument | null = null;
    if (body.context.document !== undefined) {
      try {
        document = parseProjectDocument(body.context.document);
      } catch (e) {
        if (!(e instanceof ProjectDocumentError)) throw e;
        throw new DomainError('validation_failed', {
          errors: e.issues.slice(0, 5).map((m) => ({ path: 'context.document', message: m })),
        });
      }
    }

    let history: { role: 'user' | 'assistant'; content: string; proposals: AiProposal[] }[] = [];
    let conversationId: string;
    let isNew = false;
    let title = body.message.replace(/\s+/g, ' ').slice(0, 80);
    if (body.conversationId) {
      const detail = await this.get(caller, body.conversationId);
      if ((detail.projectId ?? null) !== (body.projectId ?? null)) throw new DomainError('not_found');
      conversationId = detail.id;
      title = detail.title;
      history = detail.messages.map((m) => ({ role: m.role, content: m.content, proposals: m.proposals }));
    } else {
      conversationId = uuidv7();
      isNew = true;
    }

    const prompt = buildPrompt({
      locale,
      minor,
      mode: 'full',
      document,
      context: body.context,
      history,
      message: body.message,
      budget: this.env.AI_CONTEXT_TOKENS,
      partTypes: PART_TYPES,
      boardPins: PARTS.boardPins,
    });

    return {
      caller,
      locale,
      minor,
      resolved,
      conversationId,
      isNew,
      projectId: body.projectId ?? null,
      title,
      message: body.message,
      document,
      system: prompt.system,
      messages: prompt.messages,
      promptTokens: prompt.tokens,
      remaining,
      mode: 'full',
    };
  }

  /**
   * Streams one answer (API Spec §4.11): `start`, `delta`s and `proposal`s, then `usage` and `done` — or `filtered`
   * when the output filter stops it, or `error`. The turn is stored and metered after the stream, also when the
   * client goes away mid-answer (what was generated was paid for).
   */
  async *stream(p: PreparedChat, signal: AbortSignal): AsyncGenerator<ChatEvent> {
    const started = Date.now();
    const { resolved } = p;
    yield {
      event: 'start',
      data: { conversationId: p.conversationId, provider: resolved.id, model: resolved.model },
    };

    const abort = new AbortController();
    const onAbort = (): void => abort.abort();
    signal.addEventListener('abort', onAbort);
    let text = '';
    let filtered: string | null = null;
    const proposals: AiProposal[] = [];
    let usage: { tokensIn: number; tokensOut: number } | null = null;
    let failure: { code: string; message?: string } | null = null;
    try {
      const chunks: AsyncIterable<ChatChunk> = resolved.llm.chat({
        model: resolved.model,
        system: p.system,
        messages: p.messages,
        tools: p.mode === 'full' ? TOOLS : [],
        maxTokens: this.env.AI_MAX_OUTPUT_TOKENS,
        temperature: 0.2,
        signal: abort.signal,
      });
      for await (const chunk of chunks) {
        if (chunk.type === 'text') {
          text += chunk.text;
          const hit = checkContent(text, { minor: p.minor });
          if (hit) {
            filtered = hit;
            abort.abort();
            break;
          }
          yield { event: 'delta', data: { text: chunk.text } };
        } else if (chunk.type === 'tool_call') {
          const outcome = toProposal(chunk.name, chunk.args, p.document);
          if (outcome.ok) {
            proposals.push(outcome.proposal);
            yield { event: 'proposal', data: outcome.proposal };
          } else {
            const note =
              p.locale === 'fa'
                ? `\n\n(پیشنهاد تغییری آماده شد اما با پروژهٔ شما جور نبود: ${outcome.reason})`
                : `\n\n(I prepared a change, but it did not fit your project: ${outcome.reason})`;
            text += note;
            yield { event: 'delta', data: { text: note } };
          }
        } else {
          usage = { tokensIn: chunk.tokensIn, tokensOut: chunk.tokensOut };
        }
      }
    } catch (e) {
      if (e instanceof ProviderError) failure = { code: 'provider_error', message: e.message };
      else if (signal.aborted || abort.signal.aborted) {
        // The learner left or the filter stopped the answer.
      } else {
        this.logger.error(`AI stream failed: ${(e as Error).message}`);
        failure = { code: 'internal_error' };
      }
    } finally {
      signal.removeEventListener('abort', onAbort);
    }

    if (failure && !text && proposals.length === 0) {
      yield { event: 'error', data: failure };
      return;
    }
    if (filtered) yield { event: 'filtered', data: { category: filtered } };

    const tokens = usage ?? {
      tokensIn: p.promptTokens,
      tokensOut: resolved.llm.countTokens(text) + proposals.length * 50,
    };
    const content = filtered ? FILTERED_NOTICE[p.locale] : text;
    const messageId = await this.persist(
      p,
      content,
      filtered !== null,
      proposals,
      tokens,
      Date.now() - started,
    );
    const credits = resolved.platform ? tokens.tokensIn + tokens.tokensOut : 0;
    yield {
      event: 'usage',
      data: { ...tokens, remaining: p.remaining === null ? null : Math.max(0, p.remaining - credits) },
    };
    if (failure) yield { event: 'error', data: failure };
    yield { event: 'done', data: { messageId } };
  }

  private async persist(
    p: PreparedChat,
    content: string,
    filtered: boolean,
    proposals: AiProposal[],
    tokens: { tokensIn: number; tokensOut: number },
    latencyMs: number,
  ): Promise<string> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + days(this.historyDays(p.minor)));
    const { resolved } = p;
    return withScope(this.database.db, p.caller, async (tx) => {
      if (p.isNew) {
        await tx.insert(aiConversations).values({
          id: p.conversationId,
          workspaceId: p.caller.workspaceId,
          userId: p.caller.userId,
          projectId: p.projectId,
          title: p.title,
          mode: p.mode,
          expiresAt,
        });
      } else {
        await tx
          .update(aiConversations)
          .set({ expiresAt, updatedAt: now })
          .where(eq(aiConversations.id, p.conversationId));
      }
      await tx.insert(aiMessages).values({
        conversationId: p.conversationId,
        userId: p.caller.userId,
        role: 'user',
        content: p.message,
        createdAt: new Date(now.getTime() - 1),
      });
      const [saved] = await tx
        .insert(aiMessages)
        .values({
          conversationId: p.conversationId,
          userId: p.caller.userId,
          role: 'assistant',
          content,
          proposals,
          provider: resolved.id,
          model: resolved.model,
          tokensIn: tokens.tokensIn,
          tokensOut: tokens.tokensOut,
          filtered,
          createdAt: now,
        })
        .returning({ id: aiMessages.id });
      await tx.insert(aiUsage).values({
        workspaceId: p.caller.workspaceId,
        userId: p.caller.userId,
        provider: resolved.id,
        model: resolved.model,
        tokensIn: tokens.tokensIn,
        tokensOut: tokens.tokensOut,
        credits: resolved.platform ? tokens.tokensIn + tokens.tokensOut : 0,
        latencyMs,
      });
      if (!saved) throw new Error('message not saved');
      return saved.id;
    });
  }

  private toConversation(row: typeof aiConversations.$inferSelect): AiConversation {
    return {
      id: row.id,
      projectId: row.projectId,
      title: row.title,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    };
  }

  async list(caller: Caller, projectId: string | null): Promise<AiConversation[]> {
    const rows = await withScope(this.database.db, caller, (tx) =>
      tx
        .select()
        .from(aiConversations)
        .where(
          and(
            eq(aiConversations.userId, caller.userId),
            projectId ? eq(aiConversations.projectId, projectId) : isNull(aiConversations.projectId),
            gt(aiConversations.expiresAt, new Date()),
          ),
        )
        .orderBy(desc(aiConversations.updatedAt))
        .limit(50),
    );
    return rows.map((r) => this.toConversation(r));
  }

  async get(caller: Caller, id: string): Promise<AiConversationDetail> {
    return withScope(this.database.db, caller, async (tx) => {
      const [row] = await tx
        .select()
        .from(aiConversations)
        .where(and(eq(aiConversations.id, id), gt(aiConversations.expiresAt, new Date())));
      if (!row) throw new DomainError('not_found');
      const messages = await tx
        .select()
        .from(aiMessages)
        .where(eq(aiMessages.conversationId, id))
        .orderBy(asc(aiMessages.createdAt));
      return {
        ...this.toConversation(row),
        messages: messages.map((m): AiMessage => ({
          id: m.id,
          role: m.role,
          content: m.content,
          proposals: m.proposals as AiProposal[],
          provider: m.provider,
          model: m.model,
          filtered: m.filtered,
          createdAt: m.createdAt.toISOString(),
        })),
      };
    });
  }

  /** US-AI-03 AC3: gone from history and from storage (messages cascade). */
  async remove(caller: Caller, id: string): Promise<void> {
    const gone = await withScope(this.database.db, caller, (tx) =>
      tx.delete(aiConversations).where(eq(aiConversations.id, id)).returning({ id: aiConversations.id }),
    );
    if (!gone.length) throw new DomainError('not_found');
  }

  /** Back-office usage and estimated cost per provider and model (FR-ADM-08). */
  async report(from: Date, to: Date): Promise<AiUsageReport> {
    const [rows, prices] = await Promise.all([
      withSystem(this.database.db, (tx) =>
        tx
          .select({
            provider: aiUsage.provider,
            model: aiUsage.model,
            requests: sql<number>`count(*)::int`,
            users: sql<number>`count(distinct ${aiUsage.userId})::int`,
            tokensIn: sql<number>`coalesce(sum(${aiUsage.tokensIn}), 0)::int`,
            tokensOut: sql<number>`coalesce(sum(${aiUsage.tokensOut}), 0)::int`,
            avgLatencyMs: sql<number>`coalesce(avg(${aiUsage.latencyMs}), 0)::int`,
          })
          .from(aiUsage)
          .where(and(gte(aiUsage.createdAt, from), lt(aiUsage.createdAt, to)))
          .groupBy(aiUsage.provider, aiUsage.model)
          .orderBy(aiUsage.provider, aiUsage.model),
      ),
      this.providers.prices(),
    ]);
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      rows: rows.map((r) => {
        const cfg = prices.get(r.provider as AiProviderId);
        const costIrr =
          cfg?.priceInIrr != null && cfg.priceOutIrr != null
            ? Math.round((r.tokensIn * cfg.priceInIrr + r.tokensOut * cfg.priceOutIrr) / 1_000_000)
            : null;
        return { ...r, costIrr };
      }),
    };
  }
}
