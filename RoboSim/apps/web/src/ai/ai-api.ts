import {
  aiConversationDetailSchema,
  aiConversationListSchema,
  aiKeySchema,
  aiProposalSchema,
  aiProviderListSchema,
  aiUsageDeltaSchema,
  aiUsageSchema,
  type AiConversation,
  type AiConversationDetail,
  type AiKey,
  type AiKeyScope,
  type AiProvider,
  type AiProviderId,
  type AiUsage,
  type ChatEvent,
  type ChatRequest,
  type PutAiKeyRequest,
} from '@robosim/shared';
import { apiGet, apiSend, apiStream, readEvents } from '../lib/api.js';

/** The AI assistant API (API Spec §4.11) as the editor and the account page use it; injectable for tests. */
export interface AiClient {
  providers(): Promise<AiProvider[]>;
  usage(): Promise<AiUsage>;
  conversations(projectId: string | null): Promise<AiConversation[]>;
  conversation(id: string): Promise<AiConversationDetail>;
  deleteConversation(id: string): Promise<void>;
  putKey(provider: AiProviderId, input: PutAiKeyRequest): Promise<AiKey>;
  deleteKey(provider: AiProviderId, scope: AiKeyScope): Promise<void>;
  /** Streams one answer; refusals before the stream throw `ApiError`. */
  chat(request: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent>;
}

function parseEvent(event: string, raw: string): ChatEvent | null {
  const data = JSON.parse(raw) as Record<string, unknown>;
  switch (event) {
    case 'start':
      return { event, data: data as Extract<ChatEvent, { event: 'start' }>['data'] };
    case 'delta':
      return { event, data: { text: String(data['text'] ?? '') } };
    case 'proposal':
      return { event, data: aiProposalSchema.parse(data) };
    case 'filtered':
      return { event, data: { category: String(data['category'] ?? '') } };
    case 'usage':
      return { event, data: aiUsageDeltaSchema.parse(data) };
    case 'done':
      return { event, data: { messageId: String(data['messageId'] ?? '') } };
    case 'error':
      return {
        event,
        data: {
          code: String(data['code'] ?? 'internal_error'),
          ...(typeof data['message'] === 'string' ? { message: data['message'] } : {}),
        },
      };
    default:
      return null;
  }
}

export function aiApi(locale: () => string): AiClient {
  const id = encodeURIComponent;
  return {
    providers: async () => aiProviderListSchema.parse(await apiGet('/ai/providers', locale())).providers,
    usage: async () => aiUsageSchema.parse(await apiGet('/ai/usage', locale())),
    conversations: async (projectId) =>
      aiConversationListSchema.parse(
        await apiGet(`/ai/conversations${projectId ? `?projectId=${id(projectId)}` : ''}`, locale()),
      ).items,
    conversation: async (cid) =>
      aiConversationDetailSchema.parse(await apiGet(`/ai/conversations/${id(cid)}`, locale())),
    deleteConversation: async (cid) =>
      void (await apiSend('DELETE', `/ai/conversations/${id(cid)}`, undefined, locale())),
    putKey: async (provider, input) =>
      aiKeySchema.parse(await apiSend('PUT', `/ai/keys/${id(provider)}`, input, locale())),
    deleteKey: async (provider, scope) =>
      void (await apiSend('DELETE', `/ai/keys/${id(provider)}?scope=${id(scope)}`, undefined, locale())),
    async *chat(request, signal) {
      const response = await apiStream('/ai/chat', request, locale(), signal);
      for await (const { event, data } of readEvents(response)) {
        const parsed = parseEvent(event, data);
        if (parsed) yield parsed;
      }
    },
  };
}
