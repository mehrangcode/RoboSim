import { describe, expect, it } from 'vitest';
import {
  AnthropicProvider,
  estimateTokens,
  FakeProvider,
  GeminiProvider,
  OpenAICompatibleProvider,
  ProviderError,
  type ChatChunk,
  type LLMProvider,
} from './index.js';

type Seen = { url: string; init: RequestInit };

/** A fetch that answers every request with `body` split into small chunks (as a network would). */
function fakeFetch(status: number, body: string, seen: Seen[] = []): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), init: init ?? {} });
    const bytes = new TextEncoder().encode(body);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7));
        c.close();
      },
    });
    return new Response(stream, { status });
  }) as typeof fetch;
}

const sseBody = (events: unknown[], done = false): string =>
  events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + (done ? 'data: [DONE]\n\n' : '');

async function collect(p: LLMProvider): Promise<ChatChunk[]> {
  const out: ChatChunk[] = [];
  for await (const c of p.chat({
    model: 'm',
    system: 'sys',
    messages: [{ role: 'user', content: 'hi' }],
    tools: [{ name: 'propose_code_patch', description: 'd', parameters: { type: 'object' } }],
  })) {
    out.push(c);
  }
  return out;
}

describe('OpenAI-compatible', () => {
  it('streams text, joins tool-call fragments and reports usage', async () => {
    const seen: Seen[] = [];
    const body = sseBody(
      [
        { choices: [{ delta: { content: 'Hel' } }] },
        { choices: [{ delta: { content: 'lo' } }] },
        {
          choices: [
            {
              delta: {
                tool_calls: [{ index: 0, id: 'c1', function: { name: 'propose_', arguments: '{"a"' } }],
              },
            },
          ],
        },
        {
          choices: [
            { delta: { tool_calls: [{ index: 0, function: { name: 'code_patch', arguments: ':1}' } }] } },
          ],
        },
        { choices: [], usage: { prompt_tokens: 12, completion_tokens: 5 } },
      ],
      true,
    );
    const p = new OpenAICompatibleProvider({
      baseUrl: 'http://x/v1/',
      apiKey: 'sk',
      fetch: fakeFetch(200, body, seen),
    });
    expect(await collect(p)).toEqual([
      { type: 'text', text: 'Hel' },
      { type: 'text', text: 'lo' },
      { type: 'tool_call', id: 'c1', name: 'propose_code_patch', args: { a: 1 } },
      { type: 'usage', tokensIn: 12, tokensOut: 5 },
    ]);
    expect(seen[0]?.url).toBe('http://x/v1/chat/completions');
    expect(new Headers(seen[0]?.init.headers).get('authorization')).toBe('Bearer sk');
    const sent = JSON.parse(String(seen[0]?.init.body)) as { messages: { role: string }[]; tools: unknown[] };
    expect(sent.messages[0]).toEqual({ role: 'system', content: 'sys' });
    expect(sent.tools).toHaveLength(1);
  });

  it("reports the provider's error message and status", async () => {
    const p = new OpenAICompatibleProvider({
      baseUrl: 'http://x',
      fetch: fakeFetch(
        401,
        JSON.stringify({ error: { message: 'Incorrect API key provided: sk-...1234.' } }),
      ),
    });
    const err = await p.validate().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({
      status: 401,
      message: 'Incorrect API key provided: sk-...1234.',
      unauthorized: true,
    });
  });

  it('reports an unreachable endpoint as status 0', async () => {
    const p = new OpenAICompatibleProvider({
      baseUrl: 'http://x',
      fetch: (() => Promise.reject(new TypeError('fetch failed'))) as typeof fetch,
    });
    await expect(p.models()).rejects.toMatchObject({
      status: 0,
      message: 'could not reach the provider (fetch failed)',
    });
  });
});

describe('Anthropic', () => {
  it('streams text and tool_use blocks with usage', async () => {
    const seen: Seen[] = [];
    const body = sseBody([
      { type: 'message_start', message: { usage: { input_tokens: 30, output_tokens: 1 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Sure' } },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 't1', name: 'propose_code_patch' },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{"file":' },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '"a.ino"}' },
      },
      { type: 'content_block_stop', index: 1 },
      { type: 'message_delta', usage: { output_tokens: 9 } },
      { type: 'message_stop' },
    ]);
    const p = new AnthropicProvider({ apiKey: 'k', fetch: fakeFetch(200, body, seen) });
    expect(await collect(p)).toEqual([
      { type: 'text', text: 'Sure' },
      { type: 'tool_call', id: 't1', name: 'propose_code_patch', args: { file: 'a.ino' } },
      { type: 'usage', tokensIn: 30, tokensOut: 9 },
    ]);
    expect(seen[0]?.url).toBe('https://api.anthropic.com/v1/messages');
    const headers = new Headers(seen[0]?.init.headers);
    expect(headers.get('x-api-key')).toBe('k');
    expect(headers.get('anthropic-version')).toBe('2023-06-01');
  });
});

describe('Gemini', () => {
  it('streams parts and function calls', async () => {
    const seen: Seen[] = [];
    const body = sseBody([
      { candidates: [{ content: { parts: [{ text: 'Hi' }] } }] },
      {
        candidates: [
          { content: { parts: [{ functionCall: { name: 'propose_circuit_change', args: { x: 1 } } }] } },
        ],
        usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 3 },
      },
    ]);
    const p = new GeminiProvider({ apiKey: 'g', fetch: fakeFetch(200, body, seen) });
    expect(await collect(p)).toEqual([
      { type: 'text', text: 'Hi' },
      { type: 'tool_call', id: 'call_0', name: 'propose_circuit_change', args: { x: 1 } },
      { type: 'usage', tokensIn: 8, tokensOut: 3 },
    ]);
    expect(seen[0]?.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/m:streamGenerateContent?alt=sse',
    );
  });

  it('lists only models that generate content', async () => {
    const body = JSON.stringify({
      models: [
        { name: 'models/gemini-x', displayName: 'Gemini X', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/embed', supportedGenerationMethods: ['embedContent'] },
      ],
    });
    const p = new GeminiProvider({ apiKey: 'g', fetch: fakeFetch(200, body) });
    expect(await p.models()).toEqual([{ id: 'gemini-x', label: 'Gemini X' }]);
  });
});

describe('fake and estimates', () => {
  it('answers in the system language and adds usage', async () => {
    const out: ChatChunk[] = [];
    for await (const c of new FakeProvider().chat({
      model: 'f',
      system: 'Answer in Persian.',
      messages: [{ role: 'user', content: 'سلام' }],
    })) {
      out.push(c);
    }
    expect(
      out
        .filter((c) => c.type === 'text')
        .map((c) => (c.type === 'text' ? c.text : ''))
        .join(''),
    ).toContain('سلام');
    expect(out.at(-1)?.type).toBe('usage');
  });

  it('counts Persian denser than English', () => {
    expect(estimateTokens('abcdefgh')).toBe(2);
    expect(estimateTokens('سلامسلام')).toBe(4);
  });
});
