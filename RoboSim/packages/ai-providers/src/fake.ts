import { estimateTokens } from './http.js';
import { ProviderError, type ChatCall, type ChatChunk, type LLMProvider, type ModelInfo } from './types.js';

export type FakeScript = (call: ChatCall) => readonly ChatChunk[] | Promise<readonly ChatChunk[]>;

/**
 * Deterministic provider for tests and for development without a model server. The default script answers
 * with a short, clearly-marked echo; tests pass their own script (text, tool calls, usage, failures).
 */
export class FakeProvider implements LLMProvider {
  readonly kind = 'fake' as const;
  readonly calls: ChatCall[] = [];

  constructor(
    private readonly script: FakeScript = defaultScript,
    private readonly opts: {
      models?: readonly ModelInfo[];
      validKey?: string | undefined;
      apiKey?: string | undefined;
    } = {},
  ) {}

  async *chat(call: ChatCall): AsyncGenerator<ChatChunk> {
    this.calls.push(call);
    const chunks = await this.script(call);
    let sawUsage = false;
    for (const c of chunks) {
      if (call.signal?.aborted) return;
      if (c.type === 'usage') sawUsage = true;
      yield c;
    }
    if (!sawUsage) {
      const prompt = call.system + call.messages.map((m) => m.content).join('\n');
      const out = chunks.map((c) => (c.type === 'text' ? c.text : '')).join('');
      yield { type: 'usage', tokensIn: estimateTokens(prompt), tokensOut: estimateTokens(out) };
    }
  }

  models(): Promise<ModelInfo[]> {
    return Promise.resolve([...(this.opts.models ?? [{ id: 'fake-1', label: 'Fake model' }])]);
  }

  validate(): Promise<void> {
    if (this.opts.validKey !== undefined && this.opts.apiKey !== this.opts.validKey) {
      return Promise.reject(new ProviderError('Incorrect API key provided.', 401));
    }
    return Promise.resolve();
  }

  countTokens(text: string): number {
    return estimateTokens(text);
  }
}

function defaultScript(call: ChatCall): ChatChunk[] {
  const last = call.messages.at(-1)?.content ?? '';
  const persian = call.system.includes('Answer in Persian');
  const text = persian
    ? `(مدل آزمایشی) پیام شما را دریافت کردم: «${last.slice(0, 80)}»`
    : `(test model) I received your message: "${last.slice(0, 80)}"`;
  return text.split(/(?<= )/).map((t) => ({ type: 'text' as const, text: t }));
}
