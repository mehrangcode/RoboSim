import { findManifest } from '@robosim/catalog/manifests';
import {
  evaluateGuide,
  type GuidedCodeFacts,
  type GuidedFailure,
  type StepStatus,
} from '@robosim/circuit-canvas';
import {
  BOARD_PART,
  isGuidedProjectBody,
  type GuidedProject,
  type GuidedRef,
  type GuidedStep,
  type LocalizedText,
  type ProjectDocument,
} from '@robosim/shared';
import { Button } from '@robosim/ui';
import { Link } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormat } from '../lab/format.js';
import type { LearningClient } from '../lib/learning-api.js';
import { Markdown } from './markdown.js';
import { useGuidedProgress } from './use-guided-progress.js';

const STATUS_ICON: Record<StepStatus, string> = {
  done: '✓',
  active: '▶',
  attention: '⚠',
  locked: '○',
  upcomingDone: '✓',
};
const CELEBRATION = '🎉';

type Loaded =
  | { readonly state: 'loading' }
  | { readonly state: 'failed' }
  | { readonly state: 'locked' }
  | { readonly state: 'ready'; readonly project: GuidedProject };

/** The guided project behind a document, fetched from the API (paid content never ships in the bundle). */
function useGuidedProject(client: LearningClient, slug: string): Loaded {
  const [loaded, setLoaded] = useState<{ slug: string; value: Loaded } | null>(null);
  useEffect(() => {
    let live = true;
    client.get(slug).then(
      (r) =>
        live &&
        setLoaded({
          slug,
          value: isGuidedProjectBody(r) ? { state: 'ready', project: r } : { state: 'locked' },
        }),
      () => live && setLoaded({ slug, value: { state: 'failed' } }),
    );
    return () => {
      live = false;
    };
  }, [client, slug]);
  return loaded?.slug === slug ? loaded.value : { state: 'loading' };
}

/**
 * Pin facts of the sketch for code steps (FR-COD-06 analyser), recomputed a moment after typing stops.
 * The parser is loaded on first use, outside the initial bundle; null until it is ready.
 */
function useCodeFacts(files: ProjectDocument['code']['files'], wanted: boolean): GuidedCodeFacts | null {
  const [facts, setFacts] = useState<GuidedCodeFacts | null>(null);
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    const timer = setTimeout(() => {
      void Promise.all([import('../lab/code-analysis.js'), import('@robosim/code-analysis')]).then(
        async ([{ codeAnalysisReady }, { analyzeSketch }]) => {
          await codeAnalysisReady;
          if (live) setFacts(analyzeSketch(files));
        },
        () => undefined,
      );
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [files, wanted]);
  return facts;
}

/** Names and wording for check failures: catalogue names, pin labels in capitals. */
function useHints() {
  const { t, i18n } = useTranslation();
  const lang: keyof LocalizedText = i18n.language === 'fa' ? 'fa' : 'en';
  const partName = (type: unknown) => {
    if (type === BOARD_PART) return 'Arduino Uno';
    const m = typeof type === 'string' ? findManifest(type) : undefined;
    return m ? t(`components:${m.nameKey}`) : String(type);
  };
  const pinName = (pin: unknown) => (typeof pin === 'string' ? pin.toUpperCase() : '');
  const hint = (step: GuidedStep, f: GuidedFailure) =>
    step.hints[f.reason]?.[lang] ??
    t(`guided:reason.${f.reason}`, {
      ...f.params,
      part: partName(f.params.type),
      otherPart: partName(f.params.otherType),
      pin: pinName(f.params.pin),
      otherPin: pinName(f.params.otherPin),
    });
  return { lang, hint };
}

export interface GuidePanelProps {
  readonly guided: GuidedRef;
  /** The document as edited, with the current code. */
  readonly doc: ProjectDocument;
  readonly client: LearningClient;
  /** The live run met its success condition. */
  readonly runSucceeded: boolean;
  /** Server project id, when the project is saved in the account. */
  readonly projectId: string | null;
  /** Points the canvas at parts a hint is about. */
  readonly onShow: (parts: readonly string[]) => void;
  readonly onOpenParts: () => void;
  /** The step on screen, in the UI language (the AI assistant's context, FR-AI-01). */
  readonly onStepChange?: ((step: { title: string; instructions: string }) => void) | undefined;
}

/** The guided-project side panel (FR-LRN-01, US-LRN-01): steps checked live against the project. */
export function GuidePanel(props: GuidePanelProps) {
  const { t } = useTranslation();
  const loaded = useGuidedProject(props.client, props.guided.slug);
  if (loaded.state === 'loading')
    return <p className="p-3 text-sm text-ink-muted">{t('guided:guide.loading')}</p>;
  if (loaded.state === 'failed')
    return (
      <p role="alert" className="p-3 text-sm text-danger">
        {t('guided:guide.loadFailed')}
      </p>
    );
  if (loaded.state === 'locked')
    return (
      <div className="flex flex-col gap-2 p-3 text-sm">
        <p>{t('guided:guide.locked')}</p>
        <Link to="/plans" className="self-start text-brand-600 underline">
          {t('guided:learn.seePlans')}
        </Link>
      </div>
    );
  return <Guide {...props} project={loaded.project} />;
}

function Guide({
  project,
  doc,
  client,
  runSucceeded,
  projectId,
  onShow,
  onOpenParts,
  onStepChange,
}: GuidePanelProps & { project: GuidedProject }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const { lang, hint } = useHints();
  const { progress, record, saveFailed } = useGuidedProgress(client);
  const id = project.contentVersionId;
  const everCompleted = useMemo(() => new Set(progress?.[id]?.completedSteps ?? []), [progress, id]);
  const runSteps = useMemo(
    () => project.steps.filter((s) => s.checks.some((c) => c.kind === 'run')).map((s) => s.id),
    [project],
  );
  const hasCode = project.steps.some((s) => s.checks.some((c) => c.kind === 'code'));
  const code = useCodeFacts(doc.code.files, hasCode);
  // A success counts once; recording the run step keeps it counted after the run is reset.
  const runOk = runSucceeded || runSteps.some((s) => everCompleted.has(s));
  const state = useMemo(
    () => evaluateGuide(project.steps, { doc, code, runSucceeded: runOk }, everCompleted),
    [project, doc, code, runOk, everCompleted],
  );

  useEffect(() => {
    if (progress) record(id, state.completedIds, state.complete, projectId ?? undefined);
  }, [progress, record, id, state.completedIds, state.complete, projectId]);

  const [picked, setPicked] = useState<number | null>(null);
  const [pickedFor, setPickedFor] = useState(state.current);
  if (pickedFor !== state.current) {
    setPickedFor(state.current);
    setPicked(null);
  }
  const [solution, setSolution] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const total = project.steps.length;
  const done = state.statuses.filter((s) => s === 'done').length;
  const shown = Math.min(picked ?? state.current, total - 1);
  const step = project.steps[shown] as GuidedStep;
  const status = state.statuses[shown] as StepStatus;
  const failures = state.results[shown]?.failures ?? [];
  const working = status === 'active' || status === 'attention';
  const hints = working ? [...new Set(failures.map((f) => hint(step, f)))] : [];
  const showParts = failures.find((f) => f.parts.length)?.parts ?? [];
  // A new step starts at its top, not where the last one was scrolled to.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [shown]);
  useEffect(() => {
    onStepChange?.({ title: step.title[lang], instructions: step.body[lang] });
  }, [onStepChange, step, lang]);

  return (
    <section aria-label={t('guided:guide.label')} className="flex h-full flex-col">
      <header className="flex flex-col gap-1 border-b border-line px-3 py-2">
        <h2 className="text-sm font-semibold">{project.title[lang]}</h2>
        <div
          role="progressbar"
          aria-label={t('guided:learn.progress', { done, total })}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
          className="h-1.5 overflow-hidden rounded bg-surface-raised"
        >
          <div
            className="h-full bg-brand-600 transition-[width]"
            style={{ width: `${(100 * done) / total}%` }}
          />
        </div>
        <p className="text-xs text-ink-muted">
          {t('guided:learn.progress', { done: fmt(done), total: fmt(total) })}
        </p>
      </header>

      <div ref={scroller} className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
        {state.complete && (
          <div
            role="status"
            className="flex flex-col gap-2 rounded-md border border-brand-600 bg-surface-raised p-3"
          >
            <p className="text-base font-semibold">
              <span aria-hidden>{CELEBRATION} </span>
              {t('guided:guide.complete.title')}
            </p>
            <p className="text-sm">{t('guided:guide.complete.body')}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={onOpenParts}>
                {t('guided:guide.complete.parts')}
              </Button>
              <Link
                to="/learn"
                className="inline-flex h-8 items-center px-3 text-sm text-brand-600 underline"
              >
                {t('guided:guide.complete.more')}
              </Link>
            </div>
          </div>
        )}

        <article aria-labelledby="guide-step-title" className="flex flex-col gap-2">
          <p className="text-xs text-ink-muted">
            {t('guided:guide.stepOf', { n: fmt(shown + 1), total: fmt(total) })}
          </p>
          <h3 id="guide-step-title" className="text-base font-semibold">
            {step.title[lang]}
          </h3>
          {status === 'attention' && (
            <p role="alert" className="rounded border border-danger p-2 text-sm">
              {t('guided:guide.attention')}
            </p>
          )}
          <Markdown text={step.body[lang]} assets={project.assets} />
          {hints.length > 0 && (
            <ul aria-live="polite" className="flex flex-col gap-1 rounded-md bg-surface-raised p-2 text-sm">
              {hints.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            {working && step.checks.length === 0 && (
              <Button size="sm" onClick={() => record(id, [...state.completedIds, step.id], false)}>
                {t('guided:guide.next')}
              </Button>
            )}
            {working && showParts.length > 0 && (
              <Button size="sm" variant="secondary" onClick={() => onShow(showParts)}>
                {t('guided:guide.showMe')}
              </Button>
            )}
            {step.solution && (
              <Button
                size="sm"
                variant="ghost"
                aria-expanded={solution}
                onClick={() => setSolution((v) => !v)}
              >
                {solution ? t('guided:guide.hideSolution') : t('guided:guide.solution')}
              </Button>
            )}
          </div>
          {step.solution && solution && (
            <pre dir="ltr" className="overflow-auto rounded bg-surface-raised p-2 font-mono text-xs">
              {step.solution}
            </pre>
          )}
          {saveFailed && <p className="text-xs text-danger">{t('guided:guide.saveFailed')}</p>}
        </article>

        <nav aria-label={t('guided:guide.steps')}>
          <ol className="flex flex-col">
            {project.steps.map((s, i) => {
              const st = state.statuses[i] as StepStatus;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    aria-current={i === shown ? 'step' : undefined}
                    onClick={() => setPicked(i)}
                    className={`flex w-full items-center gap-2 rounded px-2 py-1 text-start text-sm hover:bg-surface-raised ${
                      i === shown ? 'bg-surface-raised font-semibold' : ''
                    } ${st === 'locked' ? 'text-ink-muted' : ''}`}
                  >
                    <span aria-hidden className="w-4 text-center">
                      {STATUS_ICON[st]}
                    </span>
                    <span className="flex-1">{s.title[lang]}</span>
                    <span className="sr-only">{t(`guided:guide.status.${st}`)}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
      </div>
    </section>
  );
}
