import type {
  AiConversation,
  AiConversationDetail,
  AiProvider,
  AiUsage,
  ChatEvent,
  ChatRequest,
} from '@robosim/shared';
import type { AiClient } from '../ai/ai-api.js';

/** Scripted assistant: each `chat` call plays the next script (or throws it, for refusals before the stream). */
export class FakeAi implements AiClient {
  readonly requests: ChatRequest[] = [];
  readonly calls: [string, ...unknown[]][] = [];
  scripts: (readonly ChatEvent[] | Error)[] = [];
  providerList: AiProvider[] = [
    { id: 'platform', platform: true, usable: true, blockedBy: null, defaultModel: 'qwen2.5:3b', keys: [] },
  ];
  usageInfo: AiUsage = {
    allowance: 20_000,
    used: 1_000,
    remaining: 19_000,
    resetsAt: '2026-11-30T20:30:00.000Z',
    rateLimit: { perMinute: 10, perDay: 200 },
    historyDays: 90,
  };
  history: AiConversation[] = [];
  details = new Map<string, AiConversationDetail>();

  providers = async () => this.providerList;
  usage = async () => this.usageInfo;
  conversations = async () => this.history;
  conversation = async (id: string) => {
    const d = this.details.get(id);
    if (!d) throw new Error(`no conversation ${id}`);
    return d;
  };
  deleteConversation = async (id: string) => {
    this.calls.push(['deleteConversation', id]);
    this.history = this.history.filter((c) => c.id !== id);
  };
  putKey: AiClient['putKey'] = async (provider, input) => {
    this.calls.push(['putKey', provider, input]);
    return {
      provider,
      scope: 'user',
      last4: input.key.slice(-4),
      status: 'active',
      baseUrl: null,
      error: null,
      validatedAt: null,
    };
  };
  deleteKey: AiClient['deleteKey'] = async (provider, scope) => {
    this.calls.push(['deleteKey', provider, scope]);
  };

  async *chat(request: ChatRequest): AsyncGenerator<ChatEvent> {
    this.requests.push(request);
    const script = this.scripts.shift() ?? answer('OK.');
    if (script instanceof Error) throw script;
    for (const ev of script) {
      await Promise.resolve();
      yield ev;
    }
  }
}

/** A plain streamed answer, in two deltas. */
export function answer(text: string, extra: readonly ChatEvent[] = []): ChatEvent[] {
  const half = Math.ceil(text.length / 2);
  return [
    {
      event: 'start',
      data: {
        conversationId: '01930000-0000-7000-8000-00000000c001',
        provider: 'platform',
        model: 'qwen2.5:3b',
      },
    },
    { event: 'delta', data: { text: text.slice(0, half) } },
    { event: 'delta', data: { text: text.slice(half) } },
    ...extra,
    { event: 'usage', data: { tokensIn: 300, tokensOut: 50, remaining: 18_650 } },
    { event: 'done', data: { messageId: 'm1' } },
  ];
}
