import { formatDate, formatNumber } from '@robosim/i18n';
import { type Locale, type ProjectSort, type ProjectSummary } from '@robosim/shared';
import { Button, SegmentedControl, cn } from '@robosim/ui';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SignInGate } from '../auth/auth-ui.js';
import { useAuth } from '../auth/use-auth.js';
import { PROJECT_FILE_ACCEPT, importErrorText, readProjectFile } from '../editor/project-file.js';
import { starterProject } from '../editor/starter.js';
import { ApiError } from '../lib/api.js';
import type { EntitlementsClient } from '../lib/entitlements-api.js';
import { projectsApi, type ProjectsClient } from '../lib/projects-api.js';
import { PaywallDialog } from '../plans/paywall.js';
import { paywallReason, type PaywallReason } from '../plans/paywall-reason.js';
import { useEntitlements } from '../plans/use-entitlements.js';

const SORTS: readonly ProjectSort[] = ['-updatedAt', 'name', '-createdAt'];

type Tab = 'mine' | 'shared';

/** Cloud projects: the workspace's own, and those other people shared with the caller (FR-PRJ-01, FR-PRJ-04). */
export function ProjectsPage({
  projects: injected,
  entitlements,
}: {
  projects?: ProjectsClient;
  entitlements?: EntitlementsClient;
}) {
  const { t, i18n } = useTranslation();
  // The i18n instance is stable; reading its language per request follows language switches.
  const [fallback] = useState(() => projectsApi(() => i18n.language));
  const client = injected ?? fallback;
  const [tab, setTab] = useState<Tab>('mine');
  return (
    <div className="mx-auto max-w-4xl py-6">
      <SegmentedControl
        label={t('share:tabs.label')}
        value={tab}
        options={(['mine', 'shared'] as const).map((v) => ({
          value: v,
          label: v === 'mine' ? t('share:tabs.mine') : t('share:tabs.shared'),
        }))}
        onChange={setTab}
      />
      {tab === 'mine' ? (
        <MyProjects client={client} entitlements={entitlements} />
      ) : (
        <SharedWithMe client={client} />
      )}
    </div>
  );
}

/** Projects shared with the caller, with the owner and the caller's role; the caller may leave a share. */
function SharedWithMe({ client }: { client: ProjectsClient }) {
  const { t, i18n } = useTranslation();
  const locale = (i18n.language === 'fa' ? 'fa' : 'en') satisfies Locale;
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const shared = useQuery({
    queryKey: ['projects', 'shared'],
    queryFn: () => client.sharedWithMe(),
    retry: false,
  });
  if (shared.error instanceof ApiError && shared.error.problem.code === 'unauthenticated')
    return <SignInGate />;
  const leave = async (id: string) => {
    if (me) await client.unshare(id, me.id);
    await queryClient.invalidateQueries({ queryKey: ['projects', 'shared'] });
  };
  return (
    <div className="mt-4">
      <h1 className="text-2xl font-bold tracking-tight">{t('share:tabs.shared')}</h1>
      <div className="mt-4">
        {shared.isPending ? (
          <p role="status" className="text-sm text-ink-muted">
            {t('common:status.loading')}
          </p>
        ) : shared.isError ? (
          <p role="alert" className="text-sm text-danger">
            {t('shell:projects.loadFailed', {
              message: shared.error instanceof ApiError ? shared.error.problem.title : shared.error.message,
            })}
          </p>
        ) : shared.data.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('share:sharedList.empty')}</p>
        ) : (
          <ul
            aria-label={t('share:tabs.shared')}
            className="divide-y divide-line rounded-md border border-line"
          >
            {shared.data.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <Link
                    to="/editor/$projectId"
                    params={{ projectId: p.id }}
                    className="block truncate font-medium text-brand-600 hover:underline"
                  >
                    {p.name}
                  </Link>
                  <span className="block text-xs text-ink-muted">
                    {t('share:sharedList.by', { owner: p.ownerName })} ·{' '}
                    {p.role === 'edit' ? t('share:role.edit') : t('share:role.view')} ·{' '}
                    {p.locked && <>{t('plans:locked.badge')} · </>}
                    {t('shell:projects.updatedAt', {
                      date: formatDate(locale, new Date(p.updatedAt), {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }),
                    })}
                  </span>
                </div>
                <Button size="sm" variant="secondary" onClick={() => void leave(p.id)}>
                  {t('share:sharedList.leave')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * The workspace's cloud projects (FR-PRJ-01 thin): search, sort, open, rename, duplicate, delete and trash. Over
 * the plan's cloud-project cap the older projects are read-only, and refusals open the paywall (FR-BIL-05).
 */
function MyProjects({
  client,
  entitlements,
}: {
  client: ProjectsClient;
  entitlements?: EntitlementsClient | undefined;
}) {
  const { t, i18n } = useTranslation();
  const locale = (i18n.language === 'fa' ? 'fa' : 'en') satisfies Locale;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<ProjectSort>('-updatedAt');
  const [trash, setTrash] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; undo?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [paywall, setPaywall] = useState<PaywallReason | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const usage = useEntitlements(entitlements).data?.quotas['projects.cloud_max'];

  const list = useInfiniteQuery({
    queryKey: ['projects', { q: q.trim(), sort, trash }],
    queryFn: ({ pageParam }) =>
      client.list({
        ...(q.trim() ? { q: q.trim() } : {}),
        sort,
        deleted: trash ? 'true' : 'false',
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: '',
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['projects'] });
    await queryClient.invalidateQueries({ queryKey: ['entitlements'] });
  };
  const signedOut = list.error instanceof ApiError && list.error.problem.code === 'unauthenticated';

  const message = (e: unknown) => (e instanceof ApiError ? e.problem.title : importErrorText(e, t));
  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (e) {
      const reason = paywallReason(e);
      if (reason) setPaywall(reason);
      else setNotice({ text: t('shell:projects.failed', { message: message(e) }) });
    } finally {
      setBusy(false);
    }
  };
  const open = (id: string) => navigate({ to: '/editor/$projectId', params: { projectId: id } });

  const create = () =>
    act(async () => {
      const created = await client.create({ document: starterProject(t('shell:editor.starterTitle')) });
      await open(created.id);
    });
  const importFile = (file: File | undefined) =>
    file &&
    act(async () => {
      const created = await client.create({ document: await readProjectFile(file) });
      await open(created.id);
    });
  const rename = (p: ProjectSummary, name: string) =>
    act(async () => {
      setRenaming(null);
      if (!name || name === p.name) return;
      await client.update(p.id, p.revision, { name });
      await refresh();
    });
  const duplicate = (p: ProjectSummary) =>
    act(async () => {
      await client.duplicate(p.id);
      await refresh();
    });
  const remove = (p: ProjectSummary) =>
    act(async () => {
      await client.remove(p.id);
      setNotice({ text: t('shell:projects.deleted', { name: p.name }), undo: p.id });
      await refresh();
    });
  const restore = (id: string, name?: string) =>
    act(async () => {
      const restored = await client.restore(id);
      setNotice({ text: t('shell:projects.restored', { name: name ?? restored.name }) });
      await refresh();
    });

  if (signedOut) return <SignInGate />;
  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="me-auto">
          <h1 className="text-2xl font-bold tracking-tight">{t('shell:projects.title')}</h1>
          {usage && usage.limit !== null && (
            <p className="text-xs text-ink-muted">
              {t('plans:usage.projects', {
                used: formatNumber(locale, usage.used ?? 0),
                limit: formatNumber(locale, usage.limit),
              })}{' '}
              ·{' '}
              <Link to="/plans" className="text-brand-600 hover:underline">
                {t('plans:usage.compare')}
              </Link>
            </p>
          )}
        </div>
        <Button size="sm" onClick={() => void create()} disabled={busy}>
          {t('shell:projects.new')}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => fileInput.current?.click()} disabled={busy}>
          {t('shell:editor.import')}
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept={PROJECT_FILE_ACCEPT}
          className="hidden"
          aria-label={t('shell:editor.import')}
          onChange={(e) => {
            void importFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          aria-label={t('shell:projects.search')}
          placeholder={t('shell:projects.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1 text-sm"
        />
        <select
          aria-label={t('shell:projects.sortLabel')}
          value={sort}
          onChange={(e) => setSort(e.target.value as ProjectSort)}
          className="rounded-md border border-line bg-surface px-1.5 py-1 text-sm"
        >
          {SORTS.map((s) => (
            <option key={s} value={s}>
              {t(`shell:projects.sort.${s.replace('-', '')}`)}
            </option>
          ))}
        </select>
        <Button size="sm" variant="secondary" aria-pressed={trash} onClick={() => setTrash((v) => !v)}>
          {t('shell:projects.trash')}
        </Button>
      </div>

      {paywall && <PaywallDialog reason={paywall} onClose={() => setPaywall(null)} />}
      {notice && (
        <p
          role="status"
          className="mt-3 flex items-center gap-2 rounded-md border border-line px-3 py-1.5 text-sm"
        >
          {notice.text}
          {notice.undo && (
            <Button size="sm" variant="secondary" onClick={() => notice.undo && void restore(notice.undo)}>
              {t('shell:projects.undo')}
            </Button>
          )}
          <button
            type="button"
            className="ms-auto text-ink-muted"
            onClick={() => setNotice(null)}
            aria-label={t('shell:editor.dismiss')}
          >
            ×
          </button>
        </p>
      )}

      <div className="mt-4">
        {list.isPending ? (
          <p role="status" className="text-sm text-ink-muted">
            {t('common:status.loading')}
          </p>
        ) : list.isError ? (
          <p role="alert" className="text-sm text-danger">
            {t('shell:projects.loadFailed', { message: message(list.error) })}
          </p>
        ) : items.length === 0 ? (
          <p className="text-sm text-ink-muted">
            {trash
              ? t('shell:projects.trashEmpty')
              : q.trim()
                ? t('shell:projects.noMatch')
                : t('shell:projects.empty')}
          </p>
        ) : (
          <ul
            aria-label={t('shell:projects.title')}
            className="divide-y divide-line rounded-md border border-line"
          >
            {items.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  {renaming === p.id ? (
                    <input
                      aria-label={t('shell:projects.rename')}
                      defaultValue={p.name}
                      maxLength={200}
                      autoFocus
                      onBlur={(e) => void rename(p, e.target.value.trim())}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                        if (e.key === 'Escape') setRenaming(null);
                      }}
                      className="w-full rounded border border-line bg-surface px-1 py-0.5 text-sm font-medium"
                    />
                  ) : trash ? (
                    <span className="block truncate font-medium">{p.name}</span>
                  ) : (
                    <Link
                      to="/editor/$projectId"
                      params={{ projectId: p.id }}
                      className="block truncate font-medium text-brand-600 hover:underline"
                    >
                      {p.name}
                    </Link>
                  )}
                  <span className="block text-xs text-ink-muted">
                    {p.locked && (
                      <span
                        title={t('plans:locked.badgeHint')}
                        className="me-1 rounded bg-surface-raised px-1.5 py-0.5 font-medium text-ink"
                      >
                        {t('plans:locked.badge')}
                      </span>
                    )}
                    {trash && p.deletedAt
                      ? t('shell:projects.deletedAt', {
                          date: formatDate(locale, new Date(p.deletedAt), { dateStyle: 'medium' }),
                        })
                      : t('shell:projects.updatedAt', {
                          date: formatDate(locale, new Date(p.updatedAt), {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          }),
                        })}
                    {p.tags.length > 0 && ` · ${p.tags.join(', ')}`}
                  </span>
                </div>
                <div className={cn('flex gap-1', busy && 'pointer-events-none opacity-60')}>
                  {trash ? (
                    <Button size="sm" variant="secondary" onClick={() => void restore(p.id, p.name)}>
                      {t('shell:projects.restore')}
                    </Button>
                  ) : (
                    <>
                      {!p.locked && (
                        <Button size="sm" variant="secondary" onClick={() => setRenaming(p.id)}>
                          {t('shell:projects.rename')}
                        </Button>
                      )}
                      <Button size="sm" variant="secondary" onClick={() => void duplicate(p)}>
                        {t('shell:projects.duplicate')}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => void remove(p)}>
                        {t('shell:projects.delete')}
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {list.hasNextPage && (
          <Button
            size="sm"
            variant="secondary"
            className="mt-3"
            disabled={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            {t('shell:projects.more')}
          </Button>
        )}
      </div>
    </div>
  );
}
