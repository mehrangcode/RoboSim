/**
 * `LLMProvider` (FR-AI-02, Technical Design §13): one streaming chat interface over the platform model
 * (OpenAI-compatible vLLM / Ollama) and the bring-your-own-key providers. Server-only: keys pass through here.
 */

export interface ChatMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

/** A tool the model may call; `parameters` is a JSON Schema object. */
export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

export interface ChatCall {
  readonly model: string;
  readonly system: string;
  readonly messages: readonly ChatMessage[];
  readonly tools?: readonly ToolSpec[];
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly signal?: AbortSignal;
}

export type ChatChunk =
  | { readonly type: 'text'; readonly text: string }
  /** `args` is the parsed JSON, or null when the model sent arguments that are not JSON. */
  | { readonly type: 'tool_call'; readonly id: string; readonly name: string; readonly args: unknown }
  | { readonly type: 'usage'; readonly tokensIn: number; readonly tokensOut: number };

export interface ModelInfo {
  readonly id: string;
  readonly label: string;
}

export interface LLMProvider {
  readonly kind: ProviderKind;
  chat(call: ChatCall): AsyncIterable<ChatChunk>;
  models(signal?: AbortSignal): Promise<ModelInfo[]>;
  /** A cheap authenticated call; throws `ProviderError` with the provider's message when the key is refused. */
  validate(signal?: AbortSignal): Promise<void>;
  /** Estimate for budgeting before the call; billing uses the provider's reported usage. */
  countTokens(text: string): number;
}

export type ProviderKind = 'openai-compatible' | 'anthropic' | 'gemini' | 'fake';

export interface ProviderOptions {
  readonly apiKey?: string | undefined;
  readonly baseUrl?: string | undefined;
  readonly fetch?: typeof fetch;
  /** Per request (connect + first byte); a stream may run longer. Default 60 s. */
  readonly timeoutMs?: number;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    /** HTTP status from the provider; 0 when it could not be reached. */
    readonly status: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
  /** The key or the account was refused (vs. the provider being down). */
  get unauthorized(): boolean {
    return this.status === 401 || this.status === 403;
  }
}
