import type { AiProvider, AiProviderId } from '@robosim/shared';
import { Button, Card, buttonVariants } from '@robosim/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Field, FormError } from '../auth/auth-ui.js';
import { useProblemText } from '../auth/problem-text.js';
import { aiApi, type AiClient } from './ai-api.js';

const KEY = ['ai', 'providers'] as const;

/** Bring-your-own provider keys (FR-AI-04, US-AI-04): tested on save, shown only by their last four characters. */
export function AiKeysCard({ client: injected }: { client?: AiClient }) {
  const { t, i18n } = useTranslation();
  const [fallback] = useState(() => aiApi(() => i18n.language));
  const client = injected ?? fallback;
  const providers = useQuery({ queryKey: KEY, queryFn: () => client.providers(), retry: false });
  const external = (providers.data ?? []).filter((p) => !p.platform);
  return (
    <Card aria-labelledby="account-ai">
      <h2 id="account-ai" className="font-semibold">
        {t('ai:keys.title')}
      </h2>
      <p className="mt-1 mb-4 text-sm text-ink-muted">{t('ai:keys.intro')}</p>
      {providers.isSuccess && external.length === 0 && (
        <p className="text-sm text-ink-muted">{t('ai:keys.noneEnabled')}</p>
      )}
      <ul className="flex flex-col divide-y divide-line">
        {external.map((p) => (
          <ProviderKey key={p.id} provider={p} client={client} />
        ))}
      </ul>
    </Card>
  );
}

function ProviderKey({ provider, client }: { provider: AiProvider; client: AiClient }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const problemText = useProblemText();
  const id = useId();
  const [key, setKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const name = t(`ai:provider.${provider.id}`);
  const own = provider.keys.find((k) => k.scope === 'user');
  const refresh = () => queryClient.invalidateQueries({ queryKey: KEY });
  const save = useMutation({
    mutationFn: (id: AiProviderId) =>
      client.putKey(id, {
        key: key.trim(),
        scope: 'user',
        ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
      }),
    onSuccess: async () => {
      setKey('');
      await refresh();
    },
  });
  const remove = useMutation({ mutationFn: () => client.deleteKey(provider.id, 'user'), onSuccess: refresh });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (key.trim()) save.mutate(provider.id);
  };
  const blocked = provider.blockedBy === 'byok_not_in_plan' || provider.blockedBy === 'minor_platform_only';
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="me-auto font-medium">{name}</p>
        {own && (
          <span className={`text-xs ${own.status === 'active' ? 'text-ok' : 'text-danger'}`}>
            {t(`ai:keys.status.${own.status}`, { last4: own.last4 })}
          </span>
        )}
        {own && (
          <Button
            size="sm"
            variant="ghost"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
            aria-label={t('ai:keys.deleteOf', { provider: name })}
          >
            {t('ai:keys.delete')}
          </Button>
        )}
      </div>
      {own?.error && (
        <p className="text-xs text-danger">{t('ai:keys.providerSaid', { message: own.error })}</p>
      )}
      {provider.blockedBy === 'byok_not_in_plan' && (
        <p className="text-sm text-ink-muted">
          {t('ai:keys.needsPlan')}{' '}
          <Link to="/plans" className={buttonVariants({ size: 'sm', variant: 'ghost' })}>
            {t('ai:keys.seePlans')}
          </Link>
        </p>
      )}
      {provider.blockedBy === 'minor_platform_only' && (
        <p className="text-sm text-ink-muted">{t('ai:keys.minor')}</p>
      )}
      {!blocked && (
        <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1">
            <Field
              id={`${id}-key`}
              label={
                own
                  ? t('ai:keys.replaceLabel', { provider: name })
                  : t('ai:keys.keyLabel', { provider: name })
              }
              type="password"
              autoComplete="off"
              dir="ltr"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </div>
          {provider.id === 'compatible' && (
            <div className="min-w-48 flex-1">
              <Field
                id={`${id}-url`}
                label={t('ai:keys.baseUrl')}
                type="url"
                dir="ltr"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </div>
          )}
          <Button type="submit" size="sm" disabled={!key.trim() || save.isPending}>
            {save.isPending ? t('ai:keys.testing') : t('ai:keys.save')}
          </Button>
        </form>
      )}
      <FormError
        text={save.error ? problemText(save.error) : remove.error ? problemText(remove.error) : null}
      />
    </li>
  );
}
