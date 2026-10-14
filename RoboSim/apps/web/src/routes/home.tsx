import { formatDate } from '@robosim/i18n';
import type { Locale } from '@robosim/shared';
import { Button, Card, cn } from '@robosim/ui';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiGet } from '../lib/api.js';

interface ReadyResponse {
  status: 'ok';
}

function PlatformStatus() {
  const { t, i18n } = useTranslation();
  const locale = (i18n.language === 'fa' ? 'fa' : 'en') satisfies Locale;
  const health = useQuery({
    queryKey: ['health', 'ready'],
    queryFn: () => apiGet<ReadyResponse>('/health/ready', locale),
    retry: false,
    refetchInterval: 30_000,
  });
  const ok = health.isSuccess;

  return (
    <Card aria-labelledby="platform-status" className="mt-10 max-w-xl">
      <h2 id="platform-status" className="text-sm font-semibold text-ink-muted">
        {t('shell:home.statusTitle')}
      </h2>
      <div role="status" aria-live="polite" className="mt-3 flex items-center gap-3">
        <span
          aria-hidden
          className={cn('size-2.5 rounded-full', ok ? 'bg-ok' : health.isPending ? 'bg-line' : 'bg-danger')}
        />
        <p>
          {health.isPending
            ? t('common:status.loading')
            : ok
              ? t('shell:home.statusOk')
              : t('shell:home.statusDown')}
        </p>
      </div>
      {health.dataUpdatedAt > 0 && (
        <p className="mt-2 text-xs text-ink-muted">
          {t('shell:home.lastChecked', {
            time: formatDate(locale, new Date(health.dataUpdatedAt), { timeStyle: 'short' }),
          })}
        </p>
      )}
      {health.isError && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={() => void health.refetch()}>
          {t('common:actions.retry')}
        </Button>
      )}
    </Card>
  );
}

export function Home() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-4xl py-10">
      <h1 className="text-3xl font-bold tracking-tight text-balance">{t('shell:home.title')}</h1>
      <p className="mt-4 max-w-2xl text-lg text-ink-muted text-pretty">{t('shell:home.subtitle')}</p>
      <PlatformStatus />
    </div>
  );
}
