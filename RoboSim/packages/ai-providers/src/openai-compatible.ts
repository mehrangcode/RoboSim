import { estimateTokens, json, parseArgs, request, sse, trimSlash } from './http.js';
import type { ChatCall, ChatChunk, LLMProvider, ModelInfo, ProviderOptions } from './types.js';

/**
 * OpenAI Chat Completions wire format: the platform model (vLLM, Ollama `/v1`), OpenAI, OpenRouter and
 * any compatible endpoint. Tool calls arrive as fragments per index and are emitted once complete.
 */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly kind = 'openai-compatible' as const;
  private readonly base: string;

  constructor(private readonly opts: ProviderOptions & { baseUrl: string }) {
    this.base = trimSlash(opts.baseUrl);
  }

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      ...(this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}` } : {}),
    };
  }

  async *chat(call: ChatCall): AsyncGenerator<ChatChunk> {
    const res = await request(this.opts, `${this.base}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      signal: call.signal,
      body: JSON.stringify({
        model: call.model,
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: call.maxTokens,
        temperature: call.temperature,
        messages: [{ role: 'system', content: call.system }, ...call.messages],
        tools: call.tools?.length
          ? call.tools.map((t) => ({
              type: 'function',
              function: { name: t.name, description: t.description, parameters: t.parameters },
            }))
          : undefined,
      }),
    });
    const calls = new Map<number, { id: string; name: string; args: string }>();
    let usage: ChatChunk | undefined;
    for await (const { data } of sse(res)) {
      if (data === '[DONE]') break;
      const chunk = JSON.parse(data) as {
        choices?: {
          delta?: {
            content?: string | null;
            tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
          };
        }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
      };
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.content) yield { type: 'text', text: delta.content };
      for (const tc of delta?.tool_calls ?? []) {
        const index = tc.index ?? calls.size;
        const slot = calls.get(index) ?? { id: tc.id ?? `call_${index}`, name: '', args: '' };
        if (tc.id) slot.id = tc.id;
        slot.name += tc.function?.name ?? '';
        slot.args += tc.function?.arguments ?? '';
        calls.set(index, slot);
      }
      if (chunk.usage) {
        usage = {
          type: 'usage',
          tokensIn: chunk.usage.prompt_tokens ?? 0,
          tokensOut: chunk.usage.completion_tokens ?? 0,
        };
      }
    }
    for (const c of calls.values())
      yield { type: 'tool_call', id: c.id, name: c.name, args: parseArgs(c.args) };
    if (usage) yield usage;
  }

  async models(signal?: AbortSignal): Promise<ModelInfo[]> {
    const res = await request(this.opts, `${this.base}/models`, { headers: this.headers(), signal });
    const body = await json<{ data?: { id: string; name?: string }[] }>(res);
    return (body.data ?? []).map((m) => ({ id: m.id, label: m.name ?? m.id }));
  }

  async validate(signal?: AbortSignal): Promise<void> {
    await this.models(signal);
  }

  countTokens(text: string): number {
    return estimateTokens(text);
  }
}
