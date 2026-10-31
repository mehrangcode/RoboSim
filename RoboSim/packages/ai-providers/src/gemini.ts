import { estimateTokens, json, request, sse, trimSlash } from './http.js';
import type { ChatCall, ChatChunk, LLMProvider, ModelInfo, ProviderOptions } from './types.js';

/** Google Gemini API (BYOK), `streamGenerateContent?alt=sse`. Function calls arrive whole, not in fragments. */
export class GeminiProvider implements LLMProvider {
  readonly kind = 'gemini' as const;
  private readonly base: string;

  constructor(private readonly opts: ProviderOptions) {
    this.base = trimSlash(opts.baseUrl ?? 'https://generativelanguage.googleapis.com');
  }

  private headers(): Record<string, string> {
    return { 'content-type': 'application/json', 'x-goog-api-key': this.opts.apiKey ?? '' };
  }

  async *chat(call: ChatCall): AsyncGenerator<ChatChunk> {
    const model = call.model.replace(/^models\//, '');
    const res = await request(
      this.opts,
      `${this.base}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
      {
        method: 'POST',
        headers: this.headers(),
        signal: call.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: call.system }] },
          contents: call.messages.map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          })),
          tools: call.tools?.length
            ? [
                {
                  functionDeclarations: call.tools.map((t) => ({
                    name: t.name,
                    description: t.description,
                    parameters: t.parameters,
                  })),
                },
              ]
            : undefined,
          generationConfig: { maxOutputTokens: call.maxTokens, temperature: call.temperature },
        }),
      },
    );
    let n = 0;
    let usage: ChatChunk | undefined;
    for await (const { data } of sse(res)) {
      const chunk = JSON.parse(data) as {
        candidates?: {
          content?: { parts?: { text?: string; functionCall?: { name: string; args?: unknown } }[] };
        }[];
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };
      for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
        if (part.text) yield { type: 'text', text: part.text };
        if (part.functionCall) {
          yield {
            type: 'tool_call',
            id: `call_${n++}`,
            name: part.functionCall.name,
            args: part.functionCall.args ?? {},
          };
        }
      }
      if (chunk.usageMetadata) {
        usage = {
          type: 'usage',
          tokensIn: chunk.usageMetadata.promptTokenCount ?? 0,
          tokensOut: chunk.usageMetadata.candidatesTokenCount ?? 0,
        };
      }
    }
    if (usage) yield usage;
  }

  async models(signal?: AbortSignal): Promise<ModelInfo[]> {
    const res = await request(this.opts, `${this.base}/v1beta/models?pageSize=200`, {
      headers: this.headers(),
      signal,
    });
    const body = await json<{
      models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[];
    }>(res);
    return (body.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent') ?? true)
      .map((m) => ({ id: m.name.replace(/^models\//, ''), label: m.displayName ?? m.name }));
  }

  async validate(signal?: AbortSignal): Promise<void> {
    await this.models(signal);
  }

  countTokens(text: string): number {
    return estimateTokens(text);
  }
}
