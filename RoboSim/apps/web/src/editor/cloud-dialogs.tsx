import { formatDate } from '@robosim/i18n';
import type { Locale, ProjectDocument, ProjectVersionSummary } from '@robosim/shared';
import { Button } from '@robosim/ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../lib/api.js';
import type { CloudConflict, CloudSync } from './use-cloud-sync.js';

const STAMP = { dateStyle: 'medium', timeStyle: 'short' } as const;

function Modal({
  id,
  title,
  onClose,
  children,
}: {
  id: string;
  title: string;
  onClose?: () => void;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => box.current?.querySelector<HTMLElement>('button, input')?.focus(), []);
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className="flex max-h-[85dvh] w-[min(32rem,92vw)] flex-col rounded-lg border border-line bg-surface p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose?.()}
      >
        <h2 id={id} className="mb-3 text-lg font-semibold">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

/** Someone saved first, or this browser holds edits against an older revision (API Spec §1, 412). */
export function ConflictDialog({
  conflict,
  onResolve,
}: {
  conflict: CloudConflict;
  onResolve: (keep: 'server' | 'mine') => Promise<void>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const pick = (keep: 'server' | 'mine') => {
    setBusy(true);
    void onResolve(keep).finally(() => setBusy(false));
  };
  return (
    <Modal id="conflict-title" title={t('shell:cloud.conflict.title')}>
      <p className="text-sm">
        {conflict.showing === 'mine' ? t('shell:cloud.conflict.saved') : t('shell:cloud.conflict.draft')}
      </p>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => pick('server')}>
          {t('shell:cloud.conflict.useServer')}
        </Button>
        <Button size="sm" disabled={busy} onClick={() => pick('mine')}>
          {t('shell:cloud.conflict.keepMine')}
        </Button>
      </div>
    </Modal>
  );
}

/** Checkpoints and automatic build versions of a cloud project (FR-PRJ-03). */
export function VersionsDialog({
  cloud,
  onRestored,
  onClose,
}: {
  cloud: CloudSync;
  onRestored: (doc: ProjectDocument) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = (i18n.language === 'fa' ? 'fa' : 'en') satisfies Locale;
  const [items, setItems] = useState<ProjectVersionSummary[] | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const { versions } = cloud;

  const fail = (e: unknown) => setError(e instanceof ApiError ? e.problem.title : t('shell:cloud.offline'));
  const reload = () => versions().then(setItems, fail);
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once when opened
  }, []);

  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const checkpoint = () =>
    act(async () => {
      if (!(await cloud.checkpoint(label.trim()))) throw new Error('save failed');
      setLabel('');
      await reload();
    });
  const restore = (id: string) =>
    act(async () => {
      const doc = await cloud.restoreVersion(id);
      setConfirming(null);
      if (doc) onRestored(doc);
      await reload();
    });

  return (
    <Modal id="versions-title" title={t('shell:cloud.versions.title')} onClose={onClose}>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (label.trim()) void checkpoint();
        }}
      >
        <input
          aria-label={t('shell:cloud.versions.label')}
          placeholder={t('shell:cloud.versions.label')}
          value={label}
          maxLength={120}
          onChange={(e) => setLabel(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1 text-sm"
        />
        <Button type="submit" size="sm" disabled={busy || !label.trim()}>
          {t('shell:cloud.versions.checkpoint')}
        </Button>
      </form>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
        {items === null ? (
          <p className="text-sm text-ink-muted">{t('common:status.loading')}</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('shell:cloud.versions.empty')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((v) => (
              <li key={v.id} className="flex items-center gap-2 py-1.5 text-sm">
                <span className="w-10 shrink-0 tabular-nums text-ink-muted">
                  {t('shell:cloud.versions.number', { n: v.number })}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {v.label ?? t(`shell:cloud.versions.source.${v.source}`)}
                  </span>
                  <span className="block text-xs text-ink-muted">
                    {t(`shell:cloud.versions.source.${v.source}`)} ·{' '}
                    {formatDate(locale, new Date(v.createdAt), STAMP)}
                  </span>
                </span>
                {confirming === v.id ? (
                  <>
                    <Button size="sm" disabled={busy} onClick={() => void restore(v.id)}>
                      {t('shell:cloud.versions.confirmRestore')}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setConfirming(null)}>
                      {t('shell:cloud.cancel')}
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => setConfirming(v.id)}>
                    {t('shell:cloud.versions.restore')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="mt-3 flex justify-end">
        <Button size="sm" variant="secondary" onClick={onClose}>
          {t('shell:editor.shortcuts.close')}
        </Button>
      </div>
    </Modal>
  );
}
