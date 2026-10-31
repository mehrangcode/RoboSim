import type { AiProposal, AiProviderId, ChatContext, Locale } from '@robosim/shared';
import { useCallback, useRef, useState } from 'react';
import type { AiClient } from './ai-api.js';

export interface ChatItem {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly proposals: readonly AiProposal[];
  readonly filtered: boolean;
  /** Still streaming. */
  readonly pending?: boolean;
  /** The stream failed after it started (`error` event): the server's code and message. */
  readonly failure?: { readonly code: string; readonly message?: string | undefined };
}

export interface ChatState {
  readonly conversationId: string | null;
  readonly items: readonly ChatItem[];
  readonly busy: boolean;
  /** A refusal before the stream opened (`ApiError` or network failure). */
  readonly error: unknown;
  /** Platform tokens left after the last answer (null = unlimited or BYOK). */
  readonly remaining: number | null | undefined;
}

let localIds = 0;
const localId = (): string => `local-${++localIds}`;

/** One conversation with the assistant: sends questions with the editor's context and folds the stream in. */
export function useAiChat(client: AiClient, projectId: string | null, locale: Locale) {
  const [state, setState] = useState<ChatState>({
    conversationId: null,
    items: [],
    busy: false,
    error: null,
    remaining: undefined,
  });
  const abort = useRef<AbortController | null>(null);
  /** The conversation the next question continues (read synchronously, so not from state). */
  const conversation = useRef<string | null>(null);

  const patchLast = (fn: (item: ChatItem) => ChatItem) =>
    setState((s) => ({ ...s, items: s.items.map((it, i) => (i === s.items.length - 1 ? fn(it) : it)) }));

  const send = useCallback(
    async (message: string, context: ChatContext, provider: AiProviderId | undefined) => {
      const controller = new AbortController();
      abort.current = controller;
      const conversationId = conversation.current;
      setState((s) => ({
        ...s,
        busy: true,
        error: null,
        items: [
          ...s.items,
          { id: localId(), role: 'user', content: message, proposals: [], filtered: false },
          { id: localId(), role: 'assistant', content: '', proposals: [], filtered: false, pending: true },
        ],
      }));
      try {
        const events = client.chat(
          {
            message,
            locale,
            context,
            ...(provider ? { provider } : {}),
            ...(projectId ? { projectId } : {}),
            ...(conversationId ? { conversationId } : {}),
          },
          controller.signal,
        );
        for await (const ev of events) {
          switch (ev.event) {
            case 'start':
              conversation.current = ev.data.conversationId;
              setState((s) => ({ ...s, conversationId: ev.data.conversationId }));
              break;
            case 'delta':
              patchLast((it) => ({ ...it, content: it.content + ev.data.text }));
              break;
            case 'proposal':
              patchLast((it) => ({ ...it, proposals: [...it.proposals, ev.data] }));
              break;
            case 'filtered':
              patchLast((it) => ({ ...it, content: '', filtered: true }));
              break;
            case 'usage':
              setState((s) => ({ ...s, remaining: ev.data.remaining }));
              break;
            case 'error':
              patchLast((it) => ({ ...it, failure: { code: ev.data.code, message: ev.data.message } }));
              break;
            case 'done':
              break;
          }
        }
        patchLast((it) => ({ ...it, pending: false }));
      } catch (e) {
        if (controller.signal.aborted) {
          patchLast((it) => ({ ...it, pending: false }));
        } else {
          // Refused before the stream: take the question back out so it can be edited and sent again.
          setState((s) => ({ ...s, error: e, items: s.items.slice(0, -2) }));
        }
      } finally {
        abort.current = null;
        setState((s) => ({ ...s, busy: false }));
      }
    },
    [client, projectId, locale],
  );

  const stop = useCallback(() => abort.current?.abort(), []);

  const reset = useCallback(() => {
    abort.current?.abort();
    conversation.current = null;
    setState((s) => ({ conversationId: null, items: [], busy: false, error: null, remaining: s.remaining }));
  }, []);

  const open = useCallback(
    async (id: string) => {
      abort.current?.abort();
      const detail = await client.conversation(id);
      conversation.current = detail.id;
      setState((s) => ({
        ...s,
        conversationId: detail.id,
        error: null,
        items: detail.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          proposals: m.proposals,
          filtered: m.filtered,
        })),
      }));
    },
    [client],
  );

  const dismissError = useCallback(() => setState((s) => ({ ...s, error: null })), []);

  return { state, send, stop, reset, open, dismissError };
}
