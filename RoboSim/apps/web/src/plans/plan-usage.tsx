import { formatDate, formatNumber } from '@robosim/i18n';
import type { Locale, QuotaUsage } from '@robosim/shared';
import { Card } from '@robosim/ui';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../lib/api.js';
import type { EntitlementsClient } from '../lib/entitlements-api.js';
import { useEntitlements } from './use-entitlements.js';

/** Account → Plan & usage: the plan, and how much of each daily or count limit is used. */
export function PlanUsageCard({ entitlements }: { entitlements?: EntitlementsClient }) {
  const { t, i18n } = useTranslation();
  const locale = (i18n.language === 'fa' ? 'fa' : 'en') satisfies Locale;
  const query = useEntitlements(entitlements);
  const n = (v: number) => formatNumber(locale, v);
  const when = (iso: string) =>
    formatDate(locale, new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <Card aria-labelledby="account-plan">
      <h2 id="account-plan" className="mb-4 font-semibold">
        {t('plans:usage.title')}
      </h2>
      {query.isPending ? (
        <p role="status" className="text-sm text-ink-muted">
          {t('common:status.loading')}
        </p>
      ) : query.isError ? (
        <p role="alert" className="text-sm text-danger">
          {query.error instanceof ApiError ? query.error.problem.title : query.error.message}
        </p>
      ) : (
        <div className="flex flex-col gap-4 text-sm">
          <p>
            <span className="font-medium">
              {t('plans:usage.plan', { plan: t(`plans:plan.${query.data.plan.code}`) })}
            </span>
            {query.data.plan.status === 'expired' && <> · {t('plans:status.expired')}</>}
            {query.data.plan.periodEnd && (
              <> · {t('plans:usage.until', { date: when(query.data.plan.periodEnd) })}</>
            )}
          </p>
          <Meter
            label={t('plans:row.projects')}
            usage={query.data.quotas['projects.cloud_max']}
            text={(u, l) =>
              l === null
                ? t('plans:usage.projectsUnlimited', { used: n(u) })
                : t('plans:usage.projects', { used: n(u), limit: n(l) })
            }
          />
          <Meter
            label={t('plans:row.builds')}
            usage={query.data.quotas['build.daily_quota']}
            text={(u, l) =>
              l === null
                ? t('plans:usage.buildsUnlimited', { used: n(u) })
                : t('plans:usage.builds', { used: n(u), limit: n(l) })
            }
            hint={
              query.data.quotas['build.daily_quota']?.resetsAt &&
              t('plans:usage.resets', { date: when(query.data.quotas['build.daily_quota'].resetsAt) })
            }
          />
          <p>
            {t('plans:row.parts')}:{' '}
            {query.data.settings['components.tier'] === 'all'
              ? t('plans:value.partsAll')
              : t('plans:value.partsBasic')}
          </p>
          <Link to="/plans" className="self-start text-brand-600 hover:underline">
            {t('plans:usage.compare')}
          </Link>
        </div>
      )}
    </Card>
  );
}

function Meter({
  label,
  usage,
  text,
  hint,
}: {
  label: string;
  usage: QuotaUsage | undefined;
  text: (used: number, limit: number | null) => string;
  hint?: string | undefined;
}) {
  if (!usage) return null;
  const used = usage.used ?? 0;
  return (
    <div className="flex flex-col gap-1">
      <span>{text(used, usage.limit)}</span>
      {usage.limit !== null && (
        <meter
          aria-label={label}
          min={0}
          max={Math.max(usage.limit, 1)}
          value={Math.min(used, usage.limit)}
          high={Math.max(usage.limit, 1) * 0.8}
          className="h-2 w-full"
        />
      )}
      {hint && <span className="text-xs text-ink-muted">{hint}</span>}
    </div>
  );
}
