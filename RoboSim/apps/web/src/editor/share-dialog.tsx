import { SHARE_ROLES, type ProjectSharing, type ShareRole } from '@robosim/shared';
import { Button } from '@robosim/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../lib/api.js';
import type { ProjectsClient } from '../lib/projects-api.js';
import { Modal } from './cloud-dialogs.js';

/** Owner's sharing controls (FR-PRJ-04, US-PRJ-03): the read-only link and people by email. */
export function ShareDialog({
  projectId,
  name,
  projects,
  onClose,
}: {
  projectId: string;
  name: string;
  projects: ProjectsClient;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [sharing, setSharing] = useState<ProjectSharing | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<ShareRole>('view');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fail = (e: unknown) => {
    if (e instanceof ApiError && e.problem.code === 'not_found' && e.problem.params?.['field'] === 'email')
      setError(t('share:people.notFound'));
    else if (e instanceof ApiError && e.problem.code === 'validation_failed')
      setError(t('share:people.self'));
    else setError(e instanceof ApiError ? e.problem.title : t('shell:cloud.offline'));
  };
  const act = async (work: () => Promise<ProjectSharing>) => {
    setBusy(true);
    setError(null);
    try {
      setSharing(await work());
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    let live = true;
    projects.sharing(projectId).then(
      (s) => live && setSharing(s),
      (e: unknown) => live && fail(e),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once when opened
  }, []);

  const link = sharing?.link ?? null;
  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const roleOptions = SHARE_ROLES.map((r) => (
    <option key={r} value={r}>
      {r === 'edit' ? t('share:role.edit') : t('share:role.view')}
    </option>
  ));

  return (
    <Modal id="share-title" title={t('share:dialog.title', { name })} onClose={onClose}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <section aria-labelledby="share-link-title" className="flex flex-col gap-2">
          <h3 id="share-link-title" className="text-sm font-semibold">
            {t('share:link.title')}
          </h3>
          {sharing === null ? (
            <p className="text-sm text-ink-muted">{t('common:status.loading')}</p>
          ) : link ? (
            <>
              <p className="text-xs text-ink-muted">{t('share:link.viewOnly')}</p>
              <div className="flex gap-2">
                <input
                  readOnly
                  dir="ltr"
                  aria-label={t('share:link.label')}
                  value={link.url}
                  onFocus={(e) => e.target.select()}
                  className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1 text-xs"
                />
                <Button size="sm" onClick={() => void copy()}>
                  {copied ? t('share:link.copied') : t('share:link.copy')}
                </Button>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={link.remixable}
                  disabled={busy}
                  onChange={(e) => {
                    const remixable = e.target.checked;
                    const before = sharing;
                    // Shown at once; the server's answer confirms it, a failure puts it back.
                    if (before) setSharing({ ...before, link: { ...link, remixable } });
                    setError(null);
                    projects.setLink(projectId, { remixable }).then(setSharing, (err: unknown) => {
                      setSharing(before);
                      fail(err);
                    });
                  }}
                />
                {t('share:link.remixable')}
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  title={t('share:link.regenerateHint')}
                  onClick={() => {
                    setCopied(false);
                    void act(() =>
                      projects.setLink(projectId, { remixable: link.remixable, regenerate: true }),
                    );
                  }}
                >
                  {t('share:link.regenerate')}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void act(() => projects.removeLink(projectId))}
                >
                  {t('share:link.disable')}
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-ink-muted">{t('share:link.off')}</p>
              <Button
                size="sm"
                className="self-start"
                disabled={busy}
                onClick={() => void act(() => projects.setLink(projectId, { remixable: false }))}
              >
                {t('share:link.enable')}
              </Button>
            </>
          )}
        </section>

        <section
          aria-labelledby="share-people-title"
          className="mt-5 flex flex-col gap-2 border-t border-line pt-4"
        >
          <h3 id="share-people-title" className="text-sm font-semibold">
            {t('share:people.title')}
          </h3>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const to = email.trim();
              if (!to) return;
              void act(async () => {
                const next = await projects.share(projectId, { email: to, role });
                setEmail('');
                return next;
              });
            }}
          >
            <input
              type="email"
              dir="ltr"
              required
              aria-label={t('share:people.email')}
              placeholder={t('share:people.email')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1 text-sm"
            />
            <select
              aria-label={t('share:people.role')}
              value={role}
              onChange={(e) => setRole(e.target.value as ShareRole)}
              className="rounded-md border border-line bg-surface px-1.5 py-1 text-sm"
            >
              {roleOptions}
            </select>
            <Button type="submit" size="sm" disabled={busy}>
              {t('share:people.add')}
            </Button>
          </form>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          {sharing && sharing.people.length === 0 && (
            <p className="text-sm text-ink-muted">{t('share:people.none')}</p>
          )}
          <ul className="divide-y divide-line">
            {sharing?.people.map((p) => (
              <li key={p.userId} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.displayName}</span>
                  <span dir="ltr" className="block truncate text-start text-xs text-ink-muted">
                    {p.email}
                  </span>
                </span>
                <select
                  aria-label={t('share:people.role')}
                  value={p.role}
                  disabled={busy || !p.email}
                  onChange={(e) =>
                    p.email &&
                    void act(() =>
                      projects.share(projectId, { email: p.email ?? '', role: e.target.value as ShareRole }),
                    )
                  }
                  className="rounded-md border border-line bg-surface px-1.5 py-1 text-sm"
                >
                  {roleOptions}
                </select>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await projects.unshare(projectId, p.userId);
                      return projects.sharing(projectId);
                    })
                  }
                >
                  {t('share:people.remove')}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <div className="mt-3 flex justify-end">
        <Button size="sm" variant="secondary" onClick={onClose}>
          {t('share:dialog.close')}
        </Button>
      </div>
    </Modal>
  );
}
