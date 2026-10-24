import { Button } from '@robosim/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormat } from '../lib/format.js';
import { useClient } from '../session/session.js';
import { LoadError, Loading, inputClass } from '../ui/form.js';

export function WorkspacesPage() {
  const { t } = useTranslation();
  const fmt = useFormat();
  const client = useClient();
  const { q = '' } = useSearch({ from: '/workspaces' });
  const navigate = useNavigate({ from: '/workspaces' });
  const [text, setText] = useState(q);
  const results = useQuery({
    queryKey: ['admin', 'workspaces', q],
    queryFn: () => client.searchWorkspaces(q),
  });

  const search = (e: FormEvent) => {
    e.preventDefault();
    const next = text.trim();
    void navigate({ search: next ? { q: next } : {} });
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{t('admin:workspaces.title')}</h1>
        <p className="mt-1 text-sm text-ink-muted">{t('admin:workspaces.intro')}</p>
      </header>
      <form role="search" className="flex flex-wrap items-end gap-2" onSubmit={search}>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor="workspace-search" className="text-sm font-medium">
            {t('admin:workspaces.searchLabel')}
          </label>
          <input
            id="workspace-search"
            type="search"
            className={inputClass}
            placeholder={t('admin:workspaces.searchPlaceholder')}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <Button type="submit">{t('admin:workspaces.search')}</Button>
      </form>

      {results.isPending && <Loading />}
      {results.error && <LoadError error={results.error} onRetry={() => void results.refetch()} />}
      {results.data && results.data.length === 0 && (
        <p className="py-6 text-center text-ink-muted">{t('admin:workspaces.empty')}</p>
      )}
      {results.data && results.data.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full min-w-[40rem] text-sm">
            <caption className="sr-only">
              {q ? t('admin:workspaces.resultsFor', { q }) : t('admin:workspaces.newest')}
            </caption>
            <thead className="bg-surface text-xs text-ink-muted">
              <tr>
                <th className="px-3 py-2 text-start font-medium">{t('admin:workspaces.col.name')}</th>
                <th className="px-3 py-2 text-start font-medium">{t('admin:workspaces.col.kind')}</th>
                <th className="px-3 py-2 text-start font-medium">{t('admin:workspaces.col.owner')}</th>
                <th className="px-3 py-2 text-start font-medium">{t('admin:workspaces.col.plan')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {results.data.map((ws) => (
                <tr key={ws.id}>
                  <td className="px-3 py-2">
                    <Link
                      to="/workspaces/$id"
                      params={{ id: ws.id }}
                      className="font-medium text-brand-600 hover:underline"
                    >
                      {ws.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{t(`admin:kind.${ws.kind}`)}</td>
                  <td className="px-3 py-2">
                    <div>{ws.ownerName}</div>
                    {ws.ownerEmail && (
                      <div className="text-xs text-ink-muted" dir="ltr">
                        {ws.ownerEmail}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div>
                      {t('admin:workspaces.planStatus', {
                        plan: t(`admin:planName.${ws.subscription.plan}`),
                        status: t(`admin:status.${ws.subscription.status}`),
                      })}
                    </div>
                    {ws.subscription.periodEnd && (
                      <div className="text-xs text-ink-muted">
                        {t('admin:workspaces.until', { date: fmt.date(ws.subscription.periodEnd) })}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
