import { formatNumber } from '@robosim/i18n';
import type { EntitlementValues, Locale, PublicPlan } from '@robosim/shared';
import { Button, Card, cn } from '@robosim/ui';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../lib/api.js';
import type { EntitlementsClient } from '../lib/entitlements-api.js';
import { useEntitlements, useEntitlementsClient } from './use-entitlements.js';

type Row = { key: string; value: (e: EntitlementValues) => string };

/** `/plans` (FR-BIL-05): what each self-serve plan includes. Checkout arrives with payments (P2 commerce). */
export function PlansPage({ entitlements: injected }: { entitlements?: EntitlementsClient }) {
  const { t, i18n } = useTranslation();
  const locale = (i18n.language === 'fa' ? 'fa' : 'en') satisfies Locale;
  const client = useEntitlementsClient(injected);
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => client.plans(), retry: false });
  const mine = useEntitlements(injected);
  const current = mine.data?.plan.code;

  const n = (v: number) => formatNumber(locale, v);
  const limit = (v: number | null) => (v === null ? t('plans:value.unlimited') : n(v));
  const yes = (v: boolean) => (v ? t('plans:value.yes') : t('plans:value.no'));
  const rows: Row[] = [
    { key: 'projects', value: (e) => limit(e['projects.cloud_max']) },
    { key: 'builds', value: (e) => limit(e['build.daily_quota']) },
    {
      key: 'retention',
      value: (e) =>
        e['projects.version_retention_days'] === null
          ? t('plans:value.forever')
          : t('plans:value.days', { n: e['projects.version_retention_days'] }),
    },
    {
      key: 'parts',
      value: (e) =>
        e['components.tier'] === 'all' ? t('plans:value.partsAll') : t('plans:value.partsBasic'),
    },
    {
      key: 'guided',
      value: (e) =>
        e['learning.guided_projects'] === 'all' ? t('plans:value.guidedAll') : t('plans:value.guidedFirst'),
    },
    { key: 'pdf', value: (e) => yes(e['export.pdf']) },
    { key: 'collab', value: (e) => yes(e['collab.realtime']) },
    { key: 'publish', value: (e) => yes(e['community.publish']) },
    { key: 'arenas', value: (e) => yes(e['arena.custom']) },
  ];
  const price = (p: PublicPlan) =>
    p.code === 'free'
      ? t('plans:page.free')
      : p.priceIrr === null
        ? t('plans:page.priceTbd')
        : t('plans:page.price', { price: n(p.priceIrr), interval: p.interval });

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 py-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('plans:page.title')}</h1>
        <p className="mt-2 text-ink-muted">{t('plans:page.intro')}</p>
      </div>
      {plans.isPending ? (
        <p role="status" className="text-sm text-ink-muted">
          {t('common:status.loading')}
        </p>
      ) : plans.isError ? (
        <p role="alert" className="text-sm text-danger">
          {t('plans:page.loadFailed', {
            message: plans.error instanceof ApiError ? plans.error.problem.title : plans.error.message,
          })}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {plans.data.map((p) => (
            <Card
              key={p.code}
              aria-labelledby={`plan-${p.code}`}
              className={cn('flex flex-col gap-4', current === p.code && 'ring-2 ring-brand-600')}
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <h2 id={`plan-${p.code}`} className="me-auto text-xl font-semibold">
                  {t(`plans:plan.${p.code}`)}
                </h2>
                {current === p.code && (
                  <span className="rounded-full bg-brand-600 px-2 py-0.5 text-xs font-medium text-white">
                    {t('plans:page.current')}
                  </span>
                )}
              </div>
              <p className="text-lg">{price(p)}</p>
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm">
                {rows.map((r) => (
                  <div key={r.key} className="contents">
                    <dt className="text-ink-muted">{t(`plans:row.${r.key}`)}</dt>
                    <dd className="text-end font-medium">{r.value(p.entitlements)}</dd>
                  </div>
                ))}
              </dl>
              {p.code !== 'free' && current !== p.code && (
                <div className="mt-auto flex flex-col gap-1">
                  <Button disabled aria-describedby={`plan-${p.code}-soon`}>
                    {t('plans:page.upgrade', { plan: t(`plans:plan.${p.code}`) })}
                  </Button>
                  <p id={`plan-${p.code}-soon`} className="text-xs text-ink-muted">
                    {t('plans:page.comingSoon')}
                  </p>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
      <p className="text-sm text-ink-muted">{t('plans:page.schools')}</p>
    </div>
  );
}
