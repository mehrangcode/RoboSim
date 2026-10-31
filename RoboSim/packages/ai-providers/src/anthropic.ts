import { estimateTokens, json, parseArgs, request, sse, trimSlash } from './http.js';
import type { ChatCall, ChatChunk, LLMProvider, ModelInfo, ProviderOptions } from './types.js';

const VERSION = '2023-06-01';

/** Anthropic Messages API (BYOK). Tool input arrives as `input_json_delta` fragments per content block. */
export class AnthropicProvider implements LLMProvider {
  readonly kind = 'anthropic' as const;
  private readonly base: string;

  constructor(private readonly opts: ProviderOptions) {
    this.base = trimSlash(opts.baseUrl ?? 'https://api.anthropic.com');
  }

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      'anthropic-version': VERSION,
      'x-api-key': this.opts.apiKey ?? '',
    };
  }

  async *chat(call: ChatCall): AsyncGenerator<ChatChunk> {
    const res = await request(this.opts, `${this.base}/v1/messages`, {
      method: 'POST',
      headers: this.headers(),
      signal: call.signal,
      body: JSON.stringify({
        model: call.model,
        stream: true,
        max_tokens: call.maxTokens ?? 2048,
        temperature: call.temperature,
        system: call.system,
        messages: call.messages,
        tools: call.tools?.length
          ? call.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }))
          : undefined,
      }),
    });
    const blocks = new Map<number, { id: string; name: string; args: string }>();
    let tokensIn = 0;
    let tokensOut = 0;
    for await (const { data } of sse(res)) {
      const ev = JSON.parse(data) as {
        type: string;
        index?: number;
        message?: { usage?: { input_tokens?: number; output_tokens?: number } };
        content_block?: { type: string; id?: string; name?: string };
        delta?: { type?: string; text?: string; partial_json?: string };
        usage?: { output_tokens?: number };
        error?: { message?: string };
      };
      switch (ev.type) {
        case 'message_start':
          tokensIn = ev.message?.usage?.input_tokens ?? 0;
          tokensOut = ev.message?.usage?.output_tokens ?? 0;
          break;
        case 'content_block_start':
          if (ev.content_block?.type === 'tool_use') {
            blocks.set(ev.index ?? 0, {
              id: ev.content_block.id ?? '',
              name: ev.content_block.name ?? '',
              args: '',
            });
          }
          break;
        case 'content_block_delta':
          if (ev.delta?.type === 'text_delta' && ev.delta.text) yield { type: 'text', text: ev.delta.text };
          else if (ev.delta?.type === 'input_json_delta') {
            const b = blocks.get(ev.index ?? 0);
            if (b) b.args += ev.delta.partial_json ?? '';
          }
          break;
        case 'content_block_stop': {
          const b = blocks.get(ev.index ?? 0);
          if (b) {
            blocks.delete(ev.index ?? 0);
            yield { type: 'tool_call', id: b.id, name: b.name, args: parseArgs(b.args) };
          }
          break;
        }
        case 'message_delta':
          tokensOut = ev.usage?.output_tokens ?? tokensOut;
          break;
        case 'error':
          throw new Error(ev.error?.message ?? 'stream error');
      }
    }
    yield { type: 'usage', tokensIn, tokensOut };
  }

  async models(signal?: AbortSignal): Promise<ModelInfo[]> {
    const res = await request(this.opts, `${this.base}/v1/models?limit=100`, {
      headers: this.headers(),
      signal,
    });
    const body = await json<{ data?: { id: string; display_name?: string }[] }>(res);
    return (body.data ?? []).map((m) => ({ id: m.id, label: m.display_name ?? m.id }));
  }

  async validate(signal?: AbortSignal): Promise<void> {
    await this.models(signal);
  }

  countTokens(text: string): number {
    return estimateTokens(text);
  }
}
