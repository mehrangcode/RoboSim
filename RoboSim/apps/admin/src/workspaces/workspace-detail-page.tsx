import { Card } from '@robosim/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EntitlementList } from '../entitlements/entitlement-ui.js';
import { useFormat } from '../lib/format.js';
import { useClient } from '../session/session.js';
import { LoadError, Loading } from '../ui/form.js';
import { OverridesSection } from './overrides-section.js';
import { PlanSection } from './plan-section.js';
import { workspaceKey } from './workspace-query.js';

export function WorkspaceDetailPage() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const client = useClient();
  const { id } = useParams({ from: '/workspaces/$id' });
  const ws = useQuery({ queryKey: workspaceKey(id), queryFn: () => client.workspace(id) });
  const [now] = useState(() => Date.now());
  const activeOverrideKeys = new Set(
    (ws.data?.overrides ?? [])
      .filter((o) => !o.expiresAt || new Date(o.expiresAt).getTime() > now)
      .map((o) => o.key),
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <Link to="/workspaces" className="text-sm text-brand-600 hover:underline">
        {t('admin:workspace.back')}
      </Link>
      {ws.isPending && <Loading />}
      {ws.error && <LoadError error={ws.error} onRetry={() => void ws.refetch()} />}
      {ws.data && (
        <>
          <header className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold tracking-tight">{ws.data.name}</h1>
            <p className="text-sm text-ink-muted">
              {t('admin:workspace.summary', {
                kind: t(`admin:kind.${ws.data.kind}`),
                owner: ws.data.ownerName,
              })}
              {ws.data.ownerEmail && (
                <span dir="ltr" className="ms-2">
                  {ws.data.ownerEmail}
                </span>
              )}
            </p>
            <p className="text-sm">
              {t('admin:workspace.liveProjects', {
                count: ws.data.liveProjects,
                formatted: fmt.num(ws.data.liveProjects),
              })}
            </p>
          </header>
          <PlanSection workspace={ws.data} />
          <Card aria-labelledby="effective-title" className="flex flex-col gap-3 p-4 sm:p-6">
            <h2 id="effective-title" className="text-lg font-semibold">
              {t('admin:workspace.effectiveTitle')}
            </h2>
            <p className="text-sm text-ink-muted">{t('admin:workspace.effectiveIntro')}</p>
            <EntitlementList
              values={ws.data.effective}
              marked={activeOverrideKeys}
              markLabel={t('admin:workspace.overridden')}
            />
          </Card>
          <OverridesSection workspace={ws.data} />
        </>
      )}
    </div>
  );
}
