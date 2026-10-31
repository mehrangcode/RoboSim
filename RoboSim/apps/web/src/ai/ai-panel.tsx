import { formatNumber } from '@robosim/i18n';
import type { AiProposal, AiProvider, AiProviderId, ChatContext, Locale } from '@robosim/shared';
import { Button, buttonVariants } from '@robosim/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from '@tanstack/react-router';
import { use, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '../auth/use-auth.js';
import { Markdown } from '../learn/markdown.js';
import { ApiError } from '../lib/api.js';
import { paywallReason, type PaywallReason } from '../plans/paywall-reason.js';
import type { AiClient } from './ai-api.js';
import { ProposalView } from './proposal-view.js';
import { useAiChat, type ChatItem } from './use-ai-chat.js';

export interface AiPanelProps {
  client: AiClient;
  /** The cloud project the conversation belongs to; null for a project kept in the browser. */
  projectId: string | null;
  /** The editor's context at the moment a question is sent. */
  context: () => ChatContext;
  /** Applies a suggestion; returns why it no longer fits. Absent for read-only projects. */
  onApply?: ((p: AiProposal) => string | null) | undefined;
  onPaywall: (reason: PaywallReason) => void;
}

/** AI assistant chat (FR-AI-01…05): answers stream in, suggestions wait for Apply. Signed-in users only. */
export function AiPanel(props: AiPanelProps) {
  const { t } = useTranslation();
  const auth = use(AuthContext);
  const me = auth ? auth.me : null;
  if (me === undefined) return <p className="p-2 text-sm text-ink-muted">{t('common:status.loading')}</p>;
  if (me === null) return <SignInPrompt />;
  return <Chat {...props} />;
}

function SignInPrompt() {
  const { t } = useTranslation();
  const redirect = useLocation().href;
  return (
    <div className="flex flex-col items-start gap-2 p-2 text-sm">
      <p className="font-medium">{t('ai:guest.title')}</p>
      <p className="text-ink-muted">{t('ai:guest.body')}</p>
      <Link to="/login" search={{ redirect }} className={buttonVariants({ size: 'sm' })}>
        {t('ai:guest.signIn')}
      </Link>
    </div>
  );
}

const PROVIDERS_KEY = ['ai', 'providers'] as const;
const USAGE_KEY = ['ai', 'usage'] as const;

function Chat({ client, projectId, context, onApply, onPaywall }: AiPanelProps) {
  const { t, i18n } = useTranslation();
  const locale: Locale = i18n.language === 'fa' ? 'fa' : 'en';
  const queryClient = useQueryClient();
  const id = useId();
  const providers = useQuery({ queryKey: PROVIDERS_KEY, queryFn: () => client.providers() });
  const usage = useQuery({ queryKey: USAGE_KEY, queryFn: () => client.usage() });
  const history = useQuery({
    queryKey: ['ai', 'conversations', projectId],
    queryFn: () => client.conversations(projectId),
  });
  const { state, send, stop, reset, open, dismissError } = useAiChat(client, projectId, locale);
  const [text, setText] = useState('');
  const [chosen, setChosen] = useState<AiProviderId | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const usable = (providers.data ?? []).filter((p) => p.usable);
  const provider: AiProvider | undefined = usable.find((p) => p.id === chosen) ?? usable[0];
  const listEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listEnd.current?.scrollIntoView?.({ block: 'end' });
  }, [state.items]);

  // A refusal that is about the plan opens the paywall instead of an inline error.
  useEffect(() => {
    const reason = paywallReason(state.error);
    if (!reason) return;
    onPaywall(reason);
    dismissError();
  }, [state.error, onPaywall, dismissError]);

  const ask = async (e?: FormEvent) => {
    e?.preventDefault();
    const message = text.trim();
    if (!message || state.busy) return;
    setText('');
    await send(message, context(), provider?.id);
    void queryClient.invalidateQueries({ queryKey: USAGE_KEY });
    void queryClient.invalidateQueries({ queryKey: ['ai', 'conversations', projectId] });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void ask();
    }
  };

  const remaining = state.remaining !== undefined ? state.remaining : (usage.data?.remaining ?? null);
  const allowance = usage.data?.allowance ?? null;
  const num = (n: number) => formatNumber(locale, n);

  return (
    <div className="flex h-full min-h-48 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {usable.length > 1 && (
          <label className="flex items-center gap-1">
            <span className="text-ink-muted">{t('ai:provider.label')}</span>
            <select
              className="rounded border border-line bg-surface px-1 py-0.5"
              value={provider?.id ?? ''}
              onChange={(e) => setChosen(e.target.value as AiProviderId)}
            >
              {usable.map((p) => (
                <option key={p.id} value={p.id}>
                  {t(`ai:provider.${p.id}`)}
                </option>
              ))}
            </select>
          </label>
        )}
        {provider?.platform !== false && allowance !== null && remaining !== null && (
          <span className="text-ink-muted" data-testid="ai-credits">
            {t('ai:credits.left', { left: num(remaining), total: num(allowance) })}
          </span>
        )}
        <span className="ms-auto flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={showHistory}
            onClick={() => setShowHistory((v) => !v)}
          >
            {t('ai:history.button')}
          </Button>
          <Button size="sm" variant="ghost" onClick={reset} disabled={state.items.length === 0}>
            {t('ai:newChat')}
          </Button>
        </span>
      </div>

      {showHistory && (
        <HistoryList
          items={history.data ?? []}
          activeId={state.conversationId}
          onOpen={(cid) => {
            setShowHistory(false);
            void open(cid);
          }}
          onDelete={async (cid) => {
            await client.deleteConversation(cid);
            if (cid === state.conversationId) reset();
            await history.refetch();
          }}
          historyDays={usage.data?.historyDays ?? null}
        />
      )}

      <div className="min-h-0 flex-1 overflow-auto" aria-live="polite">
        {state.items.length === 0 ? (
          <div className="flex flex-col gap-1 p-1 text-sm text-ink-muted">
            <p>{t('ai:empty.intro')}</p>
            <p>{t('ai:empty.examples')}</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3 p-1">
            {state.items.map((item) => (
              <Message key={item.id} item={item} onApply={onApply} />
            ))}
          </ul>
        )}
        <div ref={listEnd} />
      </div>

      {state.error !== null && !paywallReason(state.error) && (
        <ErrorLine error={state.error} onDismiss={dismissError} />
      )}

      <form onSubmit={(e) => void ask(e)} className="flex items-end gap-2">
        <label htmlFor={`${id}-q`} className="sr-only">
          {t('ai:input.label')}
        </label>
        <textarea
          id={`${id}-q`}
          rows={2}
          dir="auto"
          value={text}
          maxLength={4000}
          placeholder={t('ai:input.placeholder')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 resize-none rounded-md border border-line bg-surface px-2 py-1 text-sm"
        />
        {state.busy ? (
          <Button type="button" size="sm" variant="secondary" onClick={stop}>
            {t('ai:input.stop')}
          </Button>
        ) : (
          <Button type="submit" size="sm" disabled={!text.trim() || !provider}>
            {t('ai:input.send')}
          </Button>
        )}
      </form>
      <p className="text-[0.7rem] text-ink-muted">{t('ai:disclaimer')}</p>
    </div>
  );
}

function Message({ item, onApply }: { item: ChatItem; onApply: AiPanelProps['onApply'] }) {
  const { t } = useTranslation();
  if (item.role === 'user')
    return (
      <li className="self-end rounded-lg bg-brand-600/10 px-3 py-2 text-sm" dir="auto">
        <span className="sr-only">{t('ai:you')}: </span>
        {item.content}
      </li>
    );
  return (
    <li className="flex flex-col text-sm">
      <span className="sr-only">{t('ai:assistant')}: </span>
      {item.filtered ? (
        <p role="alert" className="text-ink-muted italic">
          {t('ai:filtered')}
        </p>
      ) : (
        <Answer text={item.content} />
      )}
      {item.pending && !item.content && !item.proposals.length && (
        <p role="status" className="text-ink-muted">
          {t('ai:thinking')}
        </p>
      )}
      {item.proposals.map((p) => (
        <ProposalView key={p.id} proposal={p} onApply={onApply} />
      ))}
      {item.failure && (
        <p role="alert" className="text-danger">
          {item.failure.code === 'provider_error'
            ? t('ai:error.provider', { message: item.failure.message ?? '' })
            : t('ai:error.stream')}
        </p>
      )}
    </li>
  );
}

/** Model answers: Markdown text with fenced code blocks shown as code. */
function Answer({ text }: { text: string }) {
  if (!text) return null;
  const parts = text.split(/```[^\n]*\n?/);
  return (
    <div className="flex flex-col gap-2" dir="auto">
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <pre key={i} dir="ltr" className="overflow-auto rounded bg-surface-raised p-2 font-mono text-xs">
            {part.replace(/\n$/, '')}
          </pre>
        ) : part.trim() ? (
          <Markdown key={i} text={part.trim()} assets={{}} />
        ) : null,
      )}
    </div>
  );
}

function ErrorLine({ error, onDismiss }: { error: unknown; onDismiss: () => void }) {
  const { t } = useTranslation();
  let message = t('ai:error.generic');
  if (error instanceof ApiError) {
    const reason = error.problem.params?.['reason'];
    if (error.problem.code === 'rate_limited') {
      const after = error.problem.params?.['retryAfter'];
      message = t('ai:error.rateLimited', { seconds: typeof after === 'number' ? after : 60 });
    } else if (reason === 'content_filtered') message = t('ai:error.contentFiltered');
    else if (reason === 'minor_platform_only') message = t('ai:error.minor');
    else if (reason === 'key_missing') message = t('ai:error.keyMissing');
    else if (reason === 'provider_disabled') message = t('ai:error.providerDisabled');
    else message = error.problem.title;
  }
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-danger/40 px-2 py-1 text-sm text-danger"
    >
      <p className="flex-1">{message}</p>
      <Button size="sm" variant="ghost" onClick={onDismiss}>
        {t('ai:error.dismiss')}
      </Button>
    </div>
  );
}

function HistoryList({
  items,
  activeId,
  onOpen,
  onDelete,
  historyDays,
}: {
  items: readonly { id: string; title: string; updatedAt: string }[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
  historyDays: number | null;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-md border border-line p-2 text-sm">
      {historyDays !== null && (
        <p className="mb-1 text-xs text-ink-muted">{t('ai:history.kept', { days: historyDays })}</p>
      )}
      {items.length === 0 ? (
        <p className="text-ink-muted">{t('ai:history.none')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {items.map((c) => (
            <li key={c.id} className="flex items-center gap-2 py-1">
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-start hover:underline aria-[current=true]:font-medium"
                aria-current={c.id === activeId}
                onClick={() => onOpen(c.id)}
                dir="auto"
              >
                {c.title}
              </button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={t('ai:history.deleteOf', { title: c.title })}
                onClick={() => void onDelete(c.id)}
              >
                {t('ai:history.delete')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
