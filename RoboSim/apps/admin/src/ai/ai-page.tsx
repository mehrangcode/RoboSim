import type { AiProviderConfig, UpdateAiProviderConfig } from '@robosim/shared';
import { Button, Card } from '@robosim/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormat } from '../lib/format.js';
import { useCan, useClient } from '../session/session.js';
import { useProblemText } from '../ui/form-utils.js';
import { Field, FormError, LoadError, Loading, Select } from '../ui/form.js';

const AI_PROVIDERS_KEY = ['admin', 'ai', 'providers'] as const;
const USAGE_DAYS = [7, 30, 90] as const;
const USAGE_COLUMNS = [
  'provider',
  'model',
  'requests',
  'users',
  'tokensIn',
  'tokensOut',
  'cost',
  'latency',
] as const;

/** AI back office (FR-ADM-08): providers enabled for this deployment, the model catalogue, usage and cost. */
export function AiPage() {
  const { t } = useTranslation();
  const canManage = useCan('ai');
  const canReport = useCan('aiUsage');
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{t('admin:ai.title')}</h1>
        <p className="mt-1 text-sm text-ink-muted">{t('admin:ai.intro')}</p>
      </header>
      {canManage && <ProvidersSection />}
      {canManage && <ModelsSection />}
      {canReport && <UsageSection />}
    </div>
  );
}

function ProvidersSection() {
  const { t } = useTranslation();
  const client = useClient();
  const providers = useQuery({ queryKey: AI_PROVIDERS_KEY, queryFn: () => client.aiProviders() });
  return (
    <Card className="flex flex-col gap-4 p-4 sm:p-6">
      <h2 className="text-lg font-semibold">{t('admin:ai.providers.title')}</h2>
      <p className="text-sm text-ink-muted">{t('admin:ai.providers.intro')}</p>
      {providers.isPending && <Loading />}
      {providers.error && <LoadError error={providers.error} onRetry={() => void providers.refetch()} />}
      {providers.data && (
        <ul className="divide-y divide-line">
          {providers.data.map((p) => (
            <ProviderRow key={p.provider} config={p} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function ProviderRow({ config }: { config: AiProviderConfig }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const client = useClient();
  const queryClient = useQueryClient();
  const problemText = useProblemText();
  const [editing, setEditing] = useState(false);
  const name = t(`admin:ai.provider.${config.provider}`);
  const check = useMutation({
    mutationFn: () => client.checkAiProvider(config.provider),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: AI_PROVIDERS_KEY }),
  });
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium">{name}</div>
          <div className="text-xs text-ink-muted">
            {config.enabled ? t('admin:ai.providers.enabled') : t('admin:ai.providers.disabled')}
            {config.defaultModel && (
              <> · {t('admin:ai.providers.defaultModel', { model: config.defaultModel })}</>
            )}
            {config.legalRef && (
              <>
                {' '}
                ·{' '}
                {t('admin:ai.providers.legal', {
                  ref: config.legalRef,
                  date: fmt.date(config.legalApprovedAt),
                })}
              </>
            )}
          </div>
          {config.check && (
            <div className={`text-xs ${config.check.ok ? 'text-ink-muted' : 'text-danger'}`}>
              {config.check.ok
                ? t('admin:ai.providers.checkOk', { date: fmt.date(config.check.at) })
                : t('admin:ai.providers.checkFailed', { error: config.check.error ?? '' })}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          <Button
            size="sm"
            variant="ghost"
            disabled={check.isPending}
            onClick={() => check.mutate()}
            aria-label={t('admin:ai.providers.checkOf', { provider: name })}
          >
            {t('admin:ai.providers.check')}
          </Button>
          {!editing && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setEditing(true)}
              aria-label={t('admin:ai.providers.editOf', { provider: name })}
            >
              {t('admin:ai.providers.edit')}
            </Button>
          )}
        </div>
      </div>
      {check.error && <FormError text={problemText(check.error)} />}
      {editing && <ProviderForm config={config} onDone={() => setEditing(false)} />}
    </li>
  );
}

const splitModels = (text: string): string[] =>
  text
    .split(/[\s,]+/)
    .map((m) => m.trim())
    .filter(Boolean);

const priceOrNull = (text: string): number | null | 'invalid' => {
  if (!text.trim()) return null;
  const n = Number(text.trim());
  return Number.isInteger(n) && n >= 0 ? n : 'invalid';
};

function ProviderForm({ config, onDone }: { config: AiProviderConfig; onDone: () => void }) {
  const { t } = useTranslation();
  const client = useClient();
  const queryClient = useQueryClient();
  const problemText = useProblemText();
  const id = useId();
  const external = config.provider !== 'platform';
  const [enabled, setEnabled] = useState(config.enabled);
  const [legalRef, setLegalRef] = useState(config.legalRef ?? '');
  const [baseUrl, setBaseUrl] = useState(config.baseUrl ?? '');
  const [defaultModel, setDefaultModel] = useState(config.defaultModel ?? '');
  const [models, setModels] = useState(config.models.join(', '));
  const [priceIn, setPriceIn] = useState(config.priceInIrr === null ? '' : String(config.priceInIrr));
  const [priceOut, setPriceOut] = useState(config.priceOutIrr === null ? '' : String(config.priceOutIrr));
  const [invalid, setInvalid] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (input: UpdateAiProviderConfig) => client.updateAiProvider(config.provider, input),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: AI_PROVIDERS_KEY });
      if (enabled && !saved.enabled) setInvalid(t('admin:ai.providers.enableFailed'));
      else onDone();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const pin = priceOrNull(priceIn);
    const pout = priceOrNull(priceOut);
    if (pin === 'invalid' || pout === 'invalid') return setInvalid(t('admin:ai.providers.priceInvalid'));
    if (enabled && external && !legalRef.trim()) return setInvalid(t('admin:ai.providers.legalRequired'));
    setInvalid(null);
    save.mutate({
      enabled,
      legalRef: legalRef.trim() || null,
      baseUrl: baseUrl.trim() || null,
      defaultModel: defaultModel.trim() || null,
      models: splitModels(models),
      priceInIrr: pin,
      priceOutIrr: pout,
    });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-md border border-line p-3">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        {t('admin:ai.providers.enabledLabel')}
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        {external && (
          <Field
            id={`${id}-legal`}
            label={t('admin:ai.providers.legalLabel')}
            hint={t('admin:ai.providers.legalHint')}
            value={legalRef}
            onChange={(e) => setLegalRef(e.target.value)}
          />
        )}
        <Field
          id={`${id}-base`}
          label={t('admin:ai.providers.baseUrlLabel')}
          hint={t('admin:ai.providers.baseUrlHint')}
          dir="ltr"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
        />
        <Field
          id={`${id}-model`}
          label={t('admin:ai.providers.defaultModelLabel')}
          dir="ltr"
          value={defaultModel}
          onChange={(e) => setDefaultModel(e.target.value)}
        />
        <Field
          id={`${id}-models`}
          label={t('admin:ai.providers.modelsLabel')}
          hint={t('admin:ai.providers.modelsHint')}
          dir="ltr"
          value={models}
          onChange={(e) => setModels(e.target.value)}
        />
        <Field
          id={`${id}-pin`}
          label={t('admin:ai.providers.priceInLabel')}
          inputMode="numeric"
          dir="ltr"
          value={priceIn}
          onChange={(e) => setPriceIn(e.target.value)}
        />
        <Field
          id={`${id}-pout`}
          label={t('admin:ai.providers.priceOutLabel')}
          inputMode="numeric"
          dir="ltr"
          value={priceOut}
          onChange={(e) => setPriceOut(e.target.value)}
        />
      </div>
      <FormError text={invalid ?? (save.error ? problemText(save.error) : null)} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={save.isPending}>
          {t('admin:ai.providers.save')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          {t('admin:actions.cancel')}
        </Button>
      </div>
    </form>
  );
}

function ModelsSection() {
  const { t } = useTranslation();
  const client = useClient();
  const models = useQuery({
    queryKey: ['admin', 'ai', 'platform-models'],
    queryFn: () => client.aiPlatformModels(),
  });
  return (
    <Card className="flex flex-col gap-3 p-4 sm:p-6">
      <h2 className="text-lg font-semibold">{t('admin:ai.models.title')}</h2>
      <p className="text-sm text-ink-muted">{t('admin:ai.models.intro')}</p>
      {models.isPending && <Loading />}
      {models.error && <LoadError error={models.error} onRetry={() => void models.refetch()} />}
      {models.data &&
        (models.data.length ? (
          <ul className="flex flex-wrap gap-2" dir="ltr">
            {models.data.map((m) => (
              <li key={m.id} className="rounded-md border border-line px-2 py-1 font-mono text-xs">
                {m.id}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted">{t('admin:ai.models.none')}</p>
        ))}
    </Card>
  );
}

function UsageSection() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const client = useClient();
  const id = useId();
  const [days, setDays] = useState<number>(30);
  const usage = useQuery({ queryKey: ['admin', 'ai', 'usage', days], queryFn: () => client.aiUsage(days) });
  return (
    <Card className="flex flex-col gap-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-lg font-semibold">{t('admin:ai.usage.title')}</h2>
        <Select
          id={`${id}-days`}
          label={t('admin:ai.usage.period')}
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        >
          {USAGE_DAYS.map((d) => (
            <option key={d} value={d}>
              {t('admin:ai.usage.days', { count: d })}
            </option>
          ))}
        </Select>
      </div>
      {usage.isPending && <Loading />}
      {usage.error && <LoadError error={usage.error} onRetry={() => void usage.refetch()} />}
      {usage.data &&
        (usage.data.rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-start text-sm">
              <thead className="text-xs text-ink-muted">
                <tr>
                  {USAGE_COLUMNS.map((c) => (
                    <th key={c} className="px-2 py-1 text-start font-medium">
                      {t(`admin:ai.usage.col.${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {usage.data.rows.map((r) => (
                  <tr key={`${r.provider}/${r.model}`}>
                    <td className="px-2 py-2">{t(`admin:ai.provider.${r.provider}`)}</td>
                    <td className="px-2 py-2 font-mono text-xs" dir="ltr">
                      {r.model}
                    </td>
                    <td className="px-2 py-2">{fmt.num(r.requests)}</td>
                    <td className="px-2 py-2">{fmt.num(r.users)}</td>
                    <td className="px-2 py-2">{fmt.num(r.tokensIn)}</td>
                    <td className="px-2 py-2">{fmt.num(r.tokensOut)}</td>
                    <td className="px-2 py-2">{r.costIrr === null ? '—' : fmt.price(r.costIrr)}</td>
                    <td className="px-2 py-2">
                      {t('admin:ai.usage.ms', { value: fmt.num(r.avgLatencyMs) })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-ink-muted">{t('admin:ai.usage.none')}</p>
        ))}
    </Card>
  );
}
