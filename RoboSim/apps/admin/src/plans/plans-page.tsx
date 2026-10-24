import type { AdminPlan } from '@robosim/shared';
import { Button, Card } from '@robosim/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EntitlementList } from '../entitlements/entitlement-ui.js';
import { useFormat } from '../lib/format.js';
import { useCan, useClient } from '../session/session.js';
import { LoadError, Loading } from '../ui/form.js';
import { PLANS_KEY, currentVersion } from './plans-query.js';
import { PublishVersionForm } from './publish-version-form.js';

export function PlansPage() {
  const { t } = useTranslation();
  const client = useClient();
  const plans = useQuery({ queryKey: PLANS_KEY, queryFn: () => client.plans() });
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{t('admin:plans.title')}</h1>
        <p className="mt-1 text-sm text-ink-muted">{t('admin:plans.intro')}</p>
      </header>
      {plans.isPending && <Loading />}
      {plans.error && <LoadError error={plans.error} onRetry={() => void plans.refetch()} />}
      {plans.data?.map((plan) => (
        <PlanCard key={plan.code} plan={plan} />
      ))}
    </div>
  );
}

function PlanCard({ plan }: { plan: AdminPlan }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const canPublish = useCan('plans');
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<number | null>(null);
  const current = currentVersion(plan);
  const history = plan.versions.filter((v) => v !== current);
  const headingId = `plan-${plan.code}`;

  return (
    <Card aria-labelledby={headingId} className="flex flex-col gap-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={headingId} className="text-lg font-semibold">
            {t(`admin:planName.${plan.code}`)}
            <span className="ms-2 rounded bg-surface px-1.5 py-0.5 align-middle text-xs font-normal text-ink-muted">
              {plan.public ? t('admin:plans.public') : t('admin:plans.private')}
            </span>
          </h2>
          {current && (
            <p className="mt-1 text-sm text-ink-muted">
              {t('admin:plans.currentSummary', {
                version: fmt.num(current.version),
                interval: t(`admin:interval.${current.interval}`),
                price: fmt.price(current.priceIrr),
                subscribers: fmt.num(current.subscribers),
                from: fmt.date(current.effectiveFrom),
              })}
            </p>
          )}
        </div>
        {canPublish && current && !publishing && (
          <Button
            size="sm"
            onClick={() => {
              setPublished(null);
              setPublishing(true);
            }}
          >
            {t('admin:publish.open')}
          </Button>
        )}
      </div>

      {published !== null && (
        <p role="status" className="text-sm text-ok">
          {t('admin:publish.done', { version: fmt.num(published) })}
        </p>
      )}

      {publishing && current ? (
        <PublishVersionForm
          plan={plan}
          current={current}
          onCancel={() => setPublishing(false)}
          onPublished={(version) => {
            setPublishing(false);
            setPublished(version);
          }}
        />
      ) : (
        current && <EntitlementList values={current.entitlements} />
      )}

      {history.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-brand-600">
            {t('admin:plans.history', { count: history.length })}
          </summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[32rem] text-start">
              <thead className="text-xs text-ink-muted">
                <tr>
                  <th className="px-2 py-1 text-start font-medium">{t('admin:plans.col.version')}</th>
                  <th className="px-2 py-1 text-start font-medium">{t('admin:plans.col.interval')}</th>
                  <th className="px-2 py-1 text-start font-medium">{t('admin:plans.col.price')}</th>
                  <th className="px-2 py-1 text-start font-medium">{t('admin:plans.col.period')}</th>
                  <th className="px-2 py-1 text-start font-medium">{t('admin:plans.col.subscribers')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {history.map((v) => (
                  <tr key={v.id}>
                    <td className="px-2 py-1">{fmt.num(v.version)}</td>
                    <td className="px-2 py-1">{t(`admin:interval.${v.interval}`)}</td>
                    <td className="px-2 py-1">{fmt.price(v.priceIrr)}</td>
                    <td className="px-2 py-1">
                      {t('admin:plans.periodRange', {
                        from: fmt.date(v.effectiveFrom),
                        to: fmt.date(v.effectiveTo),
                      })}
                    </td>
                    <td className="px-2 py-1">{fmt.num(v.subscribers)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </Card>
  );
}
