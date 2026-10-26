import {
  isGuidedProjectBody,
  parseProjectDocument,
  type GuidedSummary,
  type LocalizedText,
  type ProjectDocument,
} from '@robosim/shared';
import { Button, Card } from '@robosim/ui';
import { Link, useNavigate } from '@tanstack/react-router';
import { use, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '../auth/use-auth.js';
import { Modal } from '../editor/cloud-dialogs.js';
import { loadStored, runKey, saveStored } from '../editor/project-store.js';
import { useFormat } from '../lab/format.js';
import { ApiError } from '../lib/api.js';
import { learningApi, type LearningClient } from '../lib/learning-api.js';
import { projectsApi, type ProjectsClient } from '../lib/projects-api.js';
import { PaywallDialog } from '../plans/paywall.js';
import { paywallReason, type PaywallReason } from '../plans/paywall-reason.js';
import { svgDataUrl } from './svg.js';
import { useGuidedProgress, type ProgressEntry } from './use-guided-progress.js';

export interface LearnPageProps {
  learning?: LearningClient | undefined;
  projects?: ProjectsClient | undefined;
}

/** The guest's browser project unless it is untouched or already this guided project. */
function guestWork(slug: string): boolean {
  const stored = loadStored();
  return !!stored && stored.project.guided?.slug !== slug && runKey(stored.project) !== stored.pristine;
}

/**
 * Guided projects catalogue (FR-LRN-01, Journey A): start or continue a project. Signed-in learners get a new
 * project in their account; guests get it in this browser. Projects outside the plan show as a teaser.
 */
export function LearnPage({ learning, projects }: LearnPageProps) {
  const { t, i18n } = useTranslation();
  const lang: keyof LocalizedText = i18n.language === 'fa' ? 'fa' : 'en';
  const fmt = useFormat();
  const navigate = useNavigate();
  const me = use(AuthContext)?.me ?? null;
  const [fallback] = useState(() => ({
    learning: learningApi(() => i18n.language),
    projects: projectsApi(() => i18n.language),
  }));
  const client = learning ?? fallback.learning;
  const projectsClient = projects ?? fallback.projects;
  const { progress } = useGuidedProgress(client);
  const [items, setItems] = useState<GuidedSummary[] | 'failed' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replace, setReplace] = useState<GuidedSummary | null>(null);
  const [paywall, setPaywall] = useState<PaywallReason | null>(null);

  useEffect(() => {
    let live = true;
    client.list().then(
      (list) => live && setItems(list),
      () => live && setItems('failed'),
    );
    return () => {
      live = false;
    };
  }, [client, me?.id]);

  const start = async (item: GuidedSummary) => {
    setBusy(item.slug);
    setError(null);
    try {
      const full = await client.get(item.slug);
      if (!isGuidedProjectBody(full)) throw new Error(t('guided:learn.locked'));
      const starter: ProjectDocument = parseProjectDocument(full.starter);
      const document = { ...starter, meta: { ...starter.meta, title: full.title[lang] } };
      if (me) {
        const created = await projectsClient.create({ document });
        await navigate({ to: '/editor/$projectId', params: { projectId: created.id } });
      } else {
        saveStored({ project: document, pristine: runKey(document) });
        await navigate({ to: '/editor' });
      }
    } catch (e) {
      const reason = paywallReason(e);
      if (reason) setPaywall(reason);
      else
        setError(
          t('guided:learn.startFailed', {
            message: e instanceof ApiError ? e.problem.title : String((e as Error).message),
          }),
        );
    } finally {
      setBusy(null);
    }
  };

  const resume = (item: GuidedSummary, entry: ProgressEntry | undefined): (() => void) | null => {
    if (me && entry?.projectId) {
      const projectId = entry.projectId;
      return () => void navigate({ to: '/editor/$projectId', params: { projectId } });
    }
    if (!me && loadStored()?.project.guided?.slug === item.slug)
      return () => void navigate({ to: '/editor' });
    return null;
  };

  const onStart = (item: GuidedSummary) => {
    if (!me && guestWork(item.slug)) setReplace(item);
    else void start(item);
  };

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t('guided:learn.title')}</h1>
        <p className="text-ink-muted">{t('guided:learn.intro')}</p>
      </header>
      {error && (
        <p role="alert" className="rounded border border-danger p-2 text-sm text-danger">
          {error}
        </p>
      )}
      {items === null ? (
        <p className="text-sm text-ink-muted">{t('guided:learn.loading')}</p>
      ) : items === 'failed' ? (
        <p role="alert" className="text-sm text-danger">
          {t('guided:learn.loadFailed')}
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {items.map((item) => {
            const entry = progress?.[item.contentVersionId];
            const done = entry?.completedSteps.length ?? 0;
            const go = item.locked ? null : resume(item, entry);
            return (
              <li key={item.slug}>
                <Card className="flex h-full flex-col gap-3 p-4">
                  {item.cover && <img src={svgDataUrl(item.cover)} alt="" className="w-full rounded" />}
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="flex-1 text-lg font-semibold">{item.title[lang]}</h2>
                    <span className="rounded-full border border-line px-2 text-xs">
                      {item.free ? t('guided:learn.free') : t('guided:learn.maker')}
                    </span>
                  </div>
                  <p className="text-sm">{item.summary[lang]}</p>
                  <p className="text-xs text-ink-muted">
                    {t('guided:learn.minutes', { n: fmt(item.minutes) })}
                    {' · '}
                    {t('guided:learn.steps', { n: item.stepCount })}
                  </p>
                  {entry && !item.locked && (
                    <p className="text-sm">
                      {entry.completedAt
                        ? t('guided:learn.completed')
                        : t('guided:learn.progress', { done: fmt(done), total: fmt(item.stepCount) })}
                    </p>
                  )}
                  <div className="mt-auto flex flex-wrap items-center gap-2">
                    {item.locked ? (
                      <>
                        <p className="text-sm text-ink-muted">{t('guided:learn.locked')}</p>
                        <Link to="/plans" className="text-sm text-brand-600 underline">
                          {t('guided:learn.seePlans')}
                        </Link>
                      </>
                    ) : (
                      <>
                        {go && (
                          <Button size="sm" onClick={go}>
                            {t('guided:learn.continue')}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant={go ? 'secondary' : 'primary'}
                          disabled={busy !== null}
                          onClick={() => onStart(item)}
                        >
                          {busy === item.slug ? t('guided:learn.starting') : t('guided:learn.start')}
                        </Button>
                      </>
                    )}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      {replace && (
        <Modal id="replace-title" title={t('guided:learn.replaceTitle')} onClose={() => setReplace(null)}>
          <p className="mb-4 text-sm">{t('guided:learn.replaceBody')}</p>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setReplace(null)}>
              {t('guided:learn.cancel')}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                const item = replace;
                setReplace(null);
                void start(item);
              }}
            >
              {t('guided:learn.replace')}
            </Button>
          </div>
        </Modal>
      )}
      {paywall && <PaywallDialog reason={paywall} onClose={() => setPaywall(null)} />}
    </main>
  );
}
