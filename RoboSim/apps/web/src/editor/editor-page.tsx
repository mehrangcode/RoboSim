import {
  CircuitCanvas,
  LibraryPanel,
  PropertyPanel,
  copyParts,
  cutParts,
  pasteParts,
  useCircuitEditor,
  type CanvasMode,
} from '@robosim/circuit-canvas';
import {
  applyCircuitChanges,
  applyCodeEdits,
  ProposalError,
  type AiProposal,
  type ChatContext,
  type ProjectDocument,
  type SharedLink,
} from '@robosim/shared';
import { SCENARIOS, type ScenarioId, type SourceFile } from '@robosim/sim-runtime/client';
import { Button, ResizeHandle, SegmentedControl, buttonVariants, cn } from '@robosim/ui';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { findArena } from '@robosim/content/arenas';
import type { Pose } from '@robosim/renderer-2d';
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  arenaViewOf,
  conditionsModified,
  hasChassis,
  poseOf,
  poseProblem,
  robotOf,
  startPoseOf,
  withArena,
} from '../arena/arena-model.js';
import { ArenaPicker } from '../arena/arena-picker.js';
import { ArenaView } from '../arena/arena-view.js';
import { RobotView } from '../robot/robot-view.js';
import { StartPoseFields } from '../arena/start-pose-fields.js';
import { ChallengePanel } from '../lab/challenge-panel.js';
import { FindingsPanel } from '../lab/findings-panel.js';
import { LogicAnalyzer } from '../lab/logic-analyzer.js';
import { useFormat } from '../lab/format.js';
import { PinTable } from '../lab/pin-table.js';
import { SerialMonitor } from '../lab/serial-monitor.js';
import { SketchPanel } from '../lab/sketch-panel.js';
import type { EditorCommand } from '../code-editor/types.js';
import { compileWithApi, type CompileSketch } from '../lab/use-build.js';
import { useSimulation, type WorkerLike } from '../lab/use-simulation.js';
import { SignInGate } from '../auth/auth-ui.js';
import { useAuth } from '../auth/use-auth.js';
import { ApiError } from '../lib/api.js';
import { PaywallDialog } from '../plans/paywall.js';
import { paywallReason, type PaywallReason } from '../plans/paywall-reason.js';
import { projectsApi, type ProjectsClient } from '../lib/projects-api.js';
import { GuidePanel } from '../learn/guide-panel.js';
import { aiApi, type AiClient } from '../ai/ai-api.js';
import { behaviourOf, chatContext } from '../ai/ai-context.js';
import { PARTS } from '../ai/parts.js';
import { learningApi, type LearningClient } from '../lib/learning-api.js';
import { ConflictDialog, VersionsDialog } from './cloud-dialogs.js';
import { CommandPalette, type PaletteCommand } from './command-palette.js';
import { HelpDialog } from './help-dialog.js';
import { OnboardingTour } from './onboarding-tour.js';
import { useTourState, type TourStop } from './tour-state.js';
import { ShareDialog } from './share-dialog.js';
import { PROJECT_FILE_ACCEPT, downloadProject, importErrorText, readProjectFile } from './project-file.js';
import { loadStored, mainFile, runKey, saveStored, withFiles } from './project-store.js';
import { starterProject } from './starter.js';
import { useBuzzerAudio } from './use-buzzer-audio';
import { useLayout, useSizeClass, type Pane } from './use-layout.js';
import { BomPanel, type BomTab } from '../bom/bom-panel.js';
import { bomApi, type BomClient } from '../lib/bom-api.js';
import { openCloudProject, useCloudSync, type CloudOpen, type OpenResult } from './use-cloud-sync.js';
import { useRun } from './use-run.js';

const SPEEDS = ['0.25', '0.5', '1', '2', '4'] as const;
type DockTab = 'serial' | 'pins' | 'analyzer' | 'safety' | 'challenge' | 'assistant' | BomTab;

// The assistant is a chunk of its own, loaded when its tab first opens.
const AiPanel = lazy(() => import('../ai/ai-panel.js').then((m) => ({ default: m.AiPanel })));
type MobileTab = 'guide' | 'parts' | 'circuit' | 'robot' | 'code' | 'sim' | 'monitor';
type CentreView = 'circuit' | 'robot';

/** A pane with a title bar and a collapse button. */
function PaneFrame({
  title,
  onCollapse,
  actions,
  children,
  className,
  tour,
}: {
  title: string;
  onCollapse?: () => void;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Onboarding tour stop pointing at this pane. */
  tour?: TourStop;
}) {
  const { t } = useTranslation();
  return (
    <section
      aria-label={title}
      data-tour={tour}
      className={cn('flex min-h-0 min-w-0 flex-col bg-surface', className)}
    >
      <header className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-2 text-xs font-semibold text-ink-muted">
        <h2 className="truncate">{title}</h2>
        <div className="ms-auto flex items-center gap-1">
          {actions}
          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              aria-label={t('shell:editor.pane.hide', { pane: title })}
              title={t('shell:editor.pane.hide', { pane: title })}
              className="rounded px-1.5 hover:bg-surface-raised"
            >
              –
            </button>
          )}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </section>
  );
}

/** A collapsed pane: a thin rail that brings it back. */
function Rail({ title, onExpand, vertical }: { title: string; onExpand: () => void; vertical: boolean }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onExpand}
      aria-label={t('shell:editor.pane.show', { pane: title })}
      className={cn(
        'shrink-0 border-line bg-surface-raised text-xs text-ink-muted hover:text-ink',
        vertical ? 'w-7 border-x [writing-mode:vertical-rl]' : 'h-7 border-y',
      )}
    >
      {title}
    </button>
  );
}

interface EditorProps {
  createWorker?: (() => WorkerLike) | undefined;
  compileSketch?: CompileSketch | undefined;
  projects?: ProjectsClient | undefined;
  bom?: BomClient | undefined;
  learning?: LearningClient | undefined;
  ai?: AiClient | undefined;
}

/** A read-only workspace (a shared project the caller may only view): what to say and offer above it. */
interface Viewer {
  readonly banner: ReactNode;
}

/** The strip under the toolbar that says whose project this is and what the caller can do. */
function ShareBanner({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <p
      role="note"
      className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-1.5 text-sm"
    >
      <span className="me-auto">{text}</span>
      {children}
    </p>
  );
}

/** "Make a copy" / "Remix": copies the project into the caller's workspace and opens it, or shows the paywall. */
function CopyButton({ label, copy }: { label: string; copy: () => Promise<{ id: string }> }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paywall, setPaywall] = useState<PaywallReason | null>(null);
  return (
    <>
      {paywall && <PaywallDialog reason={paywall} onClose={() => setPaywall(null)} />}
      {error && (
        <span role="alert" className="text-danger">
          {error}
        </span>
      )}
      <Button
        size="sm"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          copy()
            .then((p) => navigate({ to: '/editor/$projectId', params: { projectId: p.id } }))
            .catch((e: unknown) => {
              const reason = paywallReason(e);
              if (reason) setPaywall(reason);
              else
                setError(
                  t('share:viewer.copyFailed', {
                    message: e instanceof ApiError ? e.problem.title : (e as Error).message,
                  }),
                );
            })
            .finally(() => setBusy(false));
        }}
      >
        {label}
      </Button>
    </>
  );
}

/** `/s/$token` (US-PRJ-03): anyone with the link runs the project read-only; remixing needs an account. */
export function SharedLinkPage(props: EditorProps) {
  const { t, i18n } = useTranslation();
  const { token } = useParams({ strict: false }) as { token?: string };
  const [fallback] = useState(() => projectsApi(() => i18n.language));
  const projects = props.projects ?? fallback;
  const { me } = useAuth();
  const [state, setState] = useState<
    { kind: 'opening' } | { kind: 'missing' } | { kind: 'ready'; link: SharedLink }
  >({ kind: 'opening' });
  useEffect(() => {
    if (!token) return;
    let live = true;
    void projects.openShared(token).then(
      (link) => live && setState({ kind: 'ready', link }),
      () => live && setState({ kind: 'missing' }),
    );
    return () => {
      live = false;
    };
  }, [projects, token]);
  if (!token || state.kind !== 'ready')
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <h1 className="sr-only">{t('shell:editor.title')}</h1>
        <p
          role={!token || state.kind === 'missing' ? 'alert' : 'status'}
          className={!token || state.kind === 'missing' ? 'text-danger' : 'text-ink-muted'}
        >
          {!token || state.kind === 'missing' ? t('share:viewer.missing') : t('share:viewer.opening')}
        </p>
      </div>
    );
  const { link } = state;
  const banner = (
    <ShareBanner text={t('share:viewer.banner', { owner: link.ownerName })}>
      {!link.remixable ? (
        <span className="text-ink-muted">{t('share:viewer.notRemixable')}</span>
      ) : me === null ? (
        <Link
          to="/login"
          search={{ redirect: `/s/${token ?? ''}` }}
          className={buttonVariants({ size: 'sm' })}
        >
          {t('share:viewer.remixSignIn')}
        </Link>
      ) : (
        <CopyButton label={t('share:viewer.remix')} copy={() => projects.remixShared(token ?? '')} />
      )}
    </ShareBanner>
  );
  return <Workspace {...props} projects={projects} initial={link.project.document} viewer={{ banner }} />;
}

/**
 * `/editor` edits a project kept in this browser; `/editor/$projectId` a cloud project (API Spec §4.4),
 * opened before the workspace mounts so the editor starts from its document.
 */
export function EditorPage(props: EditorProps) {
  const { i18n } = useTranslation();
  const { projectId } = useParams({ strict: false }) as { projectId?: string };
  // The i18n instance is stable; reading its language per request follows language switches.
  const [fallback] = useState(() => projectsApi(() => i18n.language));
  const projects = props.projects ?? fallback;
  if (!projectId) return <Workspace {...props} projects={projects} />;
  return <CloudWorkspace key={projectId} id={projectId} {...props} projects={projects} />;
}

function CloudWorkspace({ id, ...props }: EditorProps & { id: string; projects: ProjectsClient }) {
  const { t } = useTranslation();
  const [result, setResult] = useState<OpenResult | null>(null);
  const { projects } = props;
  useEffect(() => {
    let live = true;
    void openCloudProject(projects, id).then((r) => live && setResult(r));
    return () => {
      live = false;
    };
  }, [projects, id]);
  if (result?.kind === 'ready' && result.open.access === 'view') {
    const banner = (
      <ShareBanner text={t('share:viewer.banner', { owner: result.open.ownerName })}>
        <CopyButton label={t('share:viewer.copy')} copy={() => projects.duplicate(id)} />
      </ShareBanner>
    );
    return <Workspace {...props} initial={result.open.saved} viewer={{ banner }} />;
  }
  if (result?.kind === 'ready' && result.open.locked) {
    const banner = (
      <ShareBanner text={t('plans:locked.banner')}>
        <Link to="/plans" className={buttonVariants({ size: 'sm' })}>
          {t('plans:paywall.seePlans')}
        </Link>
      </ShareBanner>
    );
    return <Workspace {...props} initial={result.open.saved} viewer={{ banner }} />;
  }
  if (result?.kind === 'ready') return <Workspace {...props} cloudOpen={result.open} />;
  if (result?.kind === 'unauthenticated') return <SignInGate />;
  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <h1 className="sr-only">{t('shell:editor.title')}</h1>
      <p role={result ? 'alert' : 'status'} className={result ? 'text-danger' : 'text-ink-muted'}>
        {!result
          ? t('shell:cloud.opening')
          : result.kind === 'missing'
            ? t('shell:cloud.missing')
            : t('shell:cloud.openFailed', { message: result.message })}
      </p>
      {result && (
        <Link to="/projects" className="mt-6 inline-block text-brand-600 hover:underline">
          {t('shell:cloud.allProjects')}
        </Link>
      )}
    </div>
  );
}

/**
 * The editor workspace (FR-WRK-01…03): component library and properties, circuit canvas with the
 * simulation view, code, and a bottom dock with serial monitor, pin inspector, safety and challenge.
 */
function Workspace({
  createWorker,
  compileSketch,
  projects,
  bom,
  learning,
  ai,
  cloudOpen,
  initial,
  viewer,
}: EditorProps & {
  projects: ProjectsClient;
  cloudOpen?: CloudOpen;
  /** Starts from this document instead of the browser's own project (shared projects). */
  initial?: ProjectDocument;
  viewer?: Viewer;
}) {
  const { t, i18n } = useTranslation();
  const fmt = useFormat();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { demo?: string };
  const sim = useSimulation(createWorker);
  const { scene, frame, serialLog, clearSerial, send } = sim;
  const readOnly = viewer !== undefined;
  const [stored] = useState(() => (cloudOpen || initial ? null : loadStored()));
  const editor = useCircuitEditor(
    () => cloudOpen?.start ?? initial ?? stored?.project ?? starterProject(t('shell:editor.starterTitle')),
  );
  const { doc, reset } = editor;
  const [files, setFiles] = useState<readonly SourceFile[]>(() => doc.code.files);
  const [pristine, setPristine] = useState(() => stored?.pristine ?? runKey(doc));
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>('1');
  const [demoChoice, setDemoChoice] = useState<ScenarioId>('blink');
  /** Demo asked for, until the worker's scene delivers its document. */
  const opening = useRef<ScenarioId | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dockTab, setDockTab] = useState<DockTab>('serial');
  const [bomFallback] = useState(() => bomApi(() => i18n.language));
  const bomClient = bom ?? bomFallback;
  const [learningFallback] = useState(() => learningApi(() => i18n.language));
  const learningClient = learning ?? learningFallback;
  const [aiFallback] = useState(() => aiApi(() => i18n.language));
  const aiClient = ai ?? aiFallback;
  /** Label of the version to take once an applied AI suggestion has rendered (US-AI-02: Apply creates a version). */
  const aiVersion = useRef<string | null>(null);
  /** The guided step on screen, sent with questions (FR-AI-01). */
  const guidedStep = useRef<{ title: string; instructions: string } | null>(null);
  const [mobileTab, setMobileTab] = useState<MobileTab>('circuit');
  const [centre, setCentre] = useState<CentreView>('circuit');
  const [help, setHelp] = useState(false);
  /** The open palette's commands, built when it opens (it is modal, so they cannot go stale). */
  const [palette, setPalette] = useState<readonly PaletteCommand[] | null>(null);
  // Onboarding tour (FR-WRK-06): opens by itself on the first visit, again from Help or the palette.
  const tourState = useTourState();
  /** Opened or closed by hand; until then the first visit decides. */
  const [tourChoice, setTourOpen] = useState<boolean | null>(null);
  const tourOpen = tourChoice ?? (tourState.autoOpen && !readOnly);
  const finishTour = () => {
    setTourOpen(false);
    tourState.complete();
  };
  const [codeCommand, setCodeCommand] = useState<EditorCommand | null>(null);
  const codeTool = (kind: EditorCommand['kind']) => setCodeCommand((c) => ({ kind, seq: (c?.seq ?? 0) + 1 }));
  const [arenaPicker, setArenaPicker] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [paywall, setPaywall] = useState<PaywallReason | null>(null);
  const [dismissedBuild, setDismissedBuild] = useState<unknown>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const { layout, resize, toggle } = useLayout();
  const size = useSizeClass();
  const current = useMemo(() => withFiles(doc, files), [doc, files]);
  const cloud = useCloudSync(cloudOpen, projects, current);
  // A cloud build saves first and names the project, so a successful build becomes a version (FR-PRJ-03).
  const compile = compileSketch ?? compileWithApi;
  const cloudCompile: CompileSketch | undefined = cloudOpen
    ? async (request, locale) => {
        await cloud.flush();
        return compile({ ...request, projectId: cloudOpen.id }, locale);
      }
    : compileSketch;
  const run = useRun({ send, scene, compileSketch: cloudCompile, locale: i18n.language });
  const running = frame?.running ?? false;

  // Autosave on every change (a cloud project's draft is kept by useCloudSync); an edit while running stops the run.
  useEffect(() => {
    // A shared project the caller only views must never overwrite the browser's own project.
    if (!cloudOpen && !readOnly) saveStored({ project: current, pristine });
  });
  const { watch } = run;
  useEffect(() => watch(current));
  // After an applied AI suggestion renders, keep it as a version (the checkpoint saves what is on screen).
  useEffect(() => {
    const label = aiVersion.current;
    if (!label) return;
    aiVersion.current = null;
    void cloud.checkpoint(label);
  });
  useEffect(() => send({ type: 'speed', value: Number(speed) }), [speed, send]);

  /** Shows `next` in the workspace. */
  const load = (next: ProjectDocument, demoId: ScenarioId | null = null) => {
    if (run.phase !== 'edit') run.stop();
    reset(next);
    setFiles(next.code.files);
    setPristine(runKey(next));
    run.setDemo(demoId ? { id: demoId, key: runKey(next) } : null);
    run.clearBuild();
    setNotice(null);
  };
  /** Replaces the project after confirming when the current one has edits of its own. */
  const replace = (next: ProjectDocument, demoId: ScenarioId | null = null) => {
    if (runKey(current) !== pristine && !window.confirm(t('shell:editor.confirmReplace'))) return false;
    load(next, demoId);
    return true;
  };

  /** Uploads the browser project as a new cloud project and opens it. */
  const saveToCloud = async () => {
    setUploading(true);
    try {
      const created = await projects.create({ document: current });
      void navigate({ to: '/editor/$projectId', params: { projectId: created.id } });
    } catch (e) {
      const reason = paywallReason(e);
      if (reason) setPaywall(reason);
      else
        setNotice(
          t('shell:cloud.uploadFailed', {
            message: e instanceof ApiError ? e.problem.title : (e as Error).message,
          }),
        );
    } finally {
      setUploading(false);
    }
  };

  // Plan refusals (FR-BIL-05): uploading to the cloud, an autosave, or a build over the daily quota.
  const buildReason = run.build.status === 'error' ? paywallReason(run.build.cause) : null;
  const shownPaywall = paywall
    ? { reason: paywall, close: () => setPaywall(null) }
    : cloud.paywall
      ? { reason: cloud.paywall, close: cloud.dismissPaywall }
      : buildReason && dismissedBuild !== run.build
        ? { reason: buildReason, close: () => setDismissedBuild(run.build) }
        : null;

  // A demo opens once the worker has loaded it: its scene carries the document.
  useEffect(() => {
    const id = opening.current;
    if (!id || scene?.scenario !== id) return;
    opening.current = null;
    replace(scene.project, id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react to the scene arriving only
  }, [scene]);
  const openDemo = (id: ScenarioId) => {
    if (run.phase !== 'edit') run.stop();
    opening.current = id;
    send({ type: 'load', scenario: id });
  };

  // /editor?demo=blink (the Lab's "Open in editor").
  const requested = SCENARIOS.find((s) => s === search.demo);
  useEffect(() => {
    if (!requested || readOnly) return;
    openDemo(requested);
    void navigate({ to: '/editor', search: {}, replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per requested demo
  }, [requested]);

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      replace(await readProjectFile(file));
    } catch (err) {
      setNotice(t('shell:editor.importError', { message: importErrorText(err, t) }));
    }
  };

  const save = () => {
    if (readOnly) return;
    if (cloudOpen) void cloud.save();
    else
      setNotice(
        saveStored({ project: current, pristine }) ? t('shell:editor.saved') : t('shell:editor.saveFailed'),
      );
  };
  const runOrPause = () => void run.start(current, running);
  const step = () => run.ready && !running && send({ type: 'control', action: 'step' });
  const resetRun = () => run.ready && send({ type: 'control', action: 'reset' });

  // Keyboard shortcuts (FR-WRK-02).
  const keys = useRef({ runOrPause, stop: () => {}, step, resetRun, save });
  /** Toggles the command palette; refreshed after each render, once its commands are defined. */
  const openPalette = useRef(() => {});
  useEffect(() => {
    keys.current = { runOrPause, stop: () => run.phase !== 'edit' && run.stop(), step, resetRun, save };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = keys.current;
      if (e.key === 'F5' && e.shiftKey) k.stop();
      else if (e.key === 'F5') k.runOrPause();
      else if (e.key === 'F6') k.resetRun();
      else if (e.key === 'F10') k.step();
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') k.save();
      else if (e.key === 'F1') setHelp(true);
      else return;
      e.preventDefault();
    };
    // Ctrl/Cmd+K in the capture phase: Monaco would otherwise take it as a chord prefix.
    const onPalette = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'k' || e.shiftKey || e.altKey) return;
      e.preventDefault();
      e.stopPropagation();
      openPalette.current();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keydown', onPalette, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keydown', onPalette, true);
    };
  }, []);

  const live = run.ready ? frame : null;
  const sound = useBuzzerAudio(live?.parts, running);
  const canvasMode: CanvasMode =
    run.phase === 'live' ? 'run' : size === 'narrow' || readOnly ? 'view' : 'edit';

  // Arena (FR-ARN-05/06): picked from the built-ins; the start pose is edited on the stopped view.
  const docRobot = useMemo(() => robotOf(doc), [doc]);
  const docArena = doc.arena ? findArena(doc.arena.arenaVersionId) : undefined;
  const docArenaView = useMemo(() => (docArena ? arenaViewOf(docArena) : null), [docArena]);
  const startPose = poseOf(doc);
  const arenaId = doc.arena?.arenaVersionId ?? null;
  const checkPose = (p: Pose) => (arenaId && docRobot ? poseProblem(arenaId, docRobot, p) : null);
  const setStartPose = (p: Pose) =>
    editor.apply((d) => (d.arena ? { ...d, arena: { ...d.arena, startPose: startPoseOf(p) } } : d));
  const pickArena = (id: string | null) => {
    setArenaPicker(false);
    if (id === arenaId) return;
    if (conditionsModified(doc) && !window.confirm(t('shell:arena.picker.confirmReplace'))) return;
    editor.apply((d) => withArena(d, id));
  };
  const findings = live && scene ? [...scene.staticFindings, ...live.findings] : [];
  const queuedAt =
    run.phase === 'building' && run.build.status === 'building' && run.build.progress?.phase === 'queued'
      ? run.build.progress.position
      : null;
  const status =
    run.phase === 'building'
      ? queuedAt !== null
        ? t('shell:editor.status.queued', { position: queuedAt })
        : t('shell:editor.status.building')
      : run.ready && live
        ? [
            t('shell:lab.status.time', { seconds: fmt(live.simTime, 2) }),
            running ? t('shell:lab.status.rtf', { factor: fmt(live.rtf, 2) }) : t('shell:lab.status.paused'),
          ].join(' · ')
        : run.stoppedByEdit
          ? t('shell:editor.status.stoppedByEdit')
          : t('shell:editor.status.editing');

  const titles: Record<Pane | 'canvas' | 'robot', string> = {
    guide: t('guided:guide.title'),
    left: t('shell:editor.pane.parts'),
    canvas: t('shell:editor.pane.circuit'),
    robot: t('shell:editor.pane.robot'),
    code: t('shell:editor.pane.code'),
    sim: t('shell:editor.pane.sim'),
    dock: t('shell:editor.pane.monitor'),
  };

  const main = mainFile(doc);
  const codePane = main ? (
    <SketchPanel
      fill
      title={t('shell:editor.pane.code')}
      files={files}
      onChange={(name, content) =>
        !readOnly && setFiles((fs) => fs.map((f) => (f.name === name ? { ...f, content } : f)))
      }
      onFilesChange={readOnly ? undefined : setFiles}
      readOnly={readOnly}
      command={codeCommand}
      // The project pins the version it was written against (US-COD AC1, FR-COD-07).
      onLibraryAdd={(lib) =>
        editor.apply((d) => ({
          ...d,
          libraries: [
            ...d.libraries.filter((l) => l.name !== lib.name),
            { name: lib.name, version: lib.version },
          ],
        }))
      }
      state={run.build}
      modified={current !== doc}
      findings={scene?.staticFindings}
    />
  ) : null;
  const canvas = (
    <CircuitCanvas
      editor={editor}
      mode={canvasMode}
      live={live?.parts}
      damaged={live?.damaged.parts}
      onInput={(componentId, name, value) => send({ type: 'input', componentId, name, value })}
      className="h-full rounded-none border-0"
    />
  );
  // Mounting editor (FR-ARN-09): the centre pane shows the circuit or the robot from above.
  const robotProject = hasChassis(doc);
  const showRobot = robotProject && centre === 'robot';
  const robotPane = <RobotView editor={editor} disabled={canvasMode !== 'edit'} />;
  const centreSwitch = robotProject && (
    <SegmentedControl
      label={t('shell:editor.centreView')}
      value={centre}
      options={(['circuit', 'robot'] as const).map((v) => ({
        value: v,
        label: v === 'robot' ? titles.robot : titles.canvas,
      }))}
      onChange={setCentre}
    />
  );
  const leftPane = (
    <div className="flex h-full flex-col gap-3 p-2">
      <div className="flex max-h-[55%] min-h-0 flex-col">
        <LibraryPanel editor={editor} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-line pt-2">
        <PropertyPanel editor={editor} />
      </div>
    </div>
  );
  const simPane =
    live && scene?.kind === 'arena' && scene.arena ? (
      <ArenaView
        arena={scene.arena}
        robot={scene.robot ?? null}
        frame={live}
        project={scene.project}
        label={scene.title}
        className="block h-full w-full"
      />
    ) : docArena && docArenaView && startPose ? (
      <ArenaView
        key={docArena.id}
        arena={docArenaView}
        robot={docRobot}
        edit={
          canvasMode === 'edit' && docRobot
            ? { pose: startPose, check: checkPose, onChange: setStartPose }
            : null
        }
        label={t('shell:arena.view.label', { name: t(`shell:arenas.${docArena.id}.name`) })}
        className="block h-full w-full"
        footer={
          docRobot && (
            <StartPoseFields
              pose={startPose}
              disabled={canvasMode !== 'edit'}
              check={checkPose}
              onChange={setStartPose}
              onReset={() => setStartPose(docArena.spec.start)}
            />
          )
        }
      />
    ) : (
      <p className="p-3 text-sm text-ink-muted">
        {doc.arena ? t('shell:editor.sim.notRunning') : t('shell:editor.sim.bench')}
      </p>
    );
  // AI assistant (FR-AI-01, FR-AI-05): the project as it is now, and suggestions applied on request.
  const aiContext = (): ChatContext =>
    chatContext({
      doc: current,
      currentFile: main?.name,
      serial: serialLog.chunks,
      findings: findings.map((f) => ({
        rule: f.ruleId,
        severity: f.severity,
        message: t(`${f.messageKey}.title`, f.params),
      })),
      diagnostics: run.build.status === 'done' ? run.build.result.diagnostics : [],
      ...(doc.guided && guidedStep.current ? { guidedStep: guidedStep.current } : {}),
      ...(live
        ? {
            behaviour: behaviourOf(live, live.challenge, {
              challenge: live.challenge?.id ?? '',
              node: (n) => `${n.type} ${JSON.stringify(n.params)}`,
            }),
          }
        : {}),
    });
  const applyProposal = (p: AiProposal): string | null => {
    try {
      if (p.kind === 'code_patch') {
        const file = files.find((f) => f.name === p.file);
        if (!file) return t('ai:proposal.noFile', { file: p.file });
        const content = applyCodeEdits(file.content, p.edits);
        setFiles((fs) => fs.map((f) => (f.name === p.file ? { ...f, content } : f)));
      } else {
        const next = applyCircuitChanges(doc, p.changes, PARTS);
        editor.apply(() => next);
      }
    } catch (e) {
      if (e instanceof ProposalError) return e.message;
      throw e;
    }
    if (cloudOpen) aiVersion.current = t('ai:versionLabel', { summary: p.summary.slice(0, 80) });
    return null;
  };

  const dockTabs: DockTab[] = [
    'assistant',
    'serial',
    'pins',
    'analyzer',
    'safety',
    ...(live?.challenge ? (['challenge'] as const) : []),
    'parts',
    'wiring',
  ];
  // A wiring step points the circuit canvas at its wire, or at the part it plugs in.
  const showStep = (step: { kind: 'seat' | 'wire'; id: string }) => {
    editor.setSelection(
      step.kind === 'wire' ? { parts: [], wire: step.id } : { parts: [step.id], wire: null },
    );
    setCentre('circuit');
    setMobileTab('circuit');
  };
  const rememberStep = (step: { title: string; instructions: string }) => {
    guidedStep.current = step;
  };
  // Guided project (FR-LRN-01): the steps beside the workspace, checked against the project as it changes.
  const guidePane = doc.guided ? (
    <GuidePanel
      guided={doc.guided}
      doc={current}
      client={learningClient}
      runSucceeded={live?.challenge?.status === 'success'}
      projectId={cloudOpen?.id ?? null}
      onShow={(parts) => {
        editor.setSelection({ parts: [...parts], wire: null });
        setCentre('circuit');
        setMobileTab('circuit');
      }}
      onStepChange={rememberStep}
      onOpenParts={() => {
        setDockTab('parts');
        if (layout.collapsed.dock) toggle('dock');
        setMobileTab('monitor');
      }}
    />
  ) : null;
  const dock = (
    <div className="flex h-full flex-col gap-2 p-2">
      <SegmentedControl
        label={t('shell:editor.pane.monitor')}
        value={dockTabs.includes(dockTab) ? dockTab : 'serial'}
        options={dockTabs.map((v) => ({
          value: v,
          label:
            v === 'safety' && findings.length
              ? `${t(`shell:editor.dock.${v}`)} (${fmt(findings.length, 0)})`
              : t(`shell:editor.dock.${v}`),
        }))}
        onChange={setDockTab}
      />
      <div className="min-h-0 flex-1 overflow-auto">
        {dockTab === 'parts' || dockTab === 'wiring' ? (
          <BomPanel doc={current} tab={dockTab} client={bomClient} onShow={showStep} />
        ) : dockTab === 'assistant' ? (
          <Suspense fallback={<p className="text-sm text-ink-muted">{t('common:status.loading')}</p>}>
            <AiPanel
              client={aiClient}
              projectId={cloudOpen?.id ?? null}
              context={aiContext}
              onApply={readOnly ? undefined : applyProposal}
              onPaywall={setPaywall}
            />
          </Suspense>
        ) : !live || !scene ? (
          <p className="text-sm text-ink-muted">{t('shell:editor.dock.notRunning')}</p>
        ) : dockTab === 'pins' ? (
          <PinTable bare scene={scene} frame={live} />
        ) : dockTab === 'analyzer' ? (
          <LogicAnalyzer
            pins={scene.pins}
            capture={sim.capture}
            probing={sim.probing}
            probe={sim.probe}
            onClear={sim.clearCapture}
          />
        ) : dockTab === 'safety' ? (
          <FindingsPanel
            findings={findings}
            partTypes={Object.fromEntries(scene.parts.map((p) => [p.id, p.type]))}
          />
        ) : dockTab === 'challenge' && live.challenge ? (
          <ChallengePanel challenge={live.challenge} send={send} />
        ) : scene.serial ? (
          <SerialMonitor bare log={serialLog} send={send} onClear={clearSerial} />
        ) : (
          <p className="text-sm text-ink-muted">{t('shell:editor.dock.noSerial')}</p>
        )}
      </div>
    </div>
  );

  // Command palette (FR-WRK-05): the toolbar's actions under the same conditions, plus code, circuit
  // and panel commands and every part.
  const paletteCommands = (): PaletteCommand[] => {
    const editing = !readOnly;
    const circuit = canvasMode === 'edit';
    const parts = editor.selection.parts.length > 0;
    const openDock = (tab: DockTab) => {
      setDockTab(tab);
      if (layout.collapsed.dock) toggle('dock');
      setMobileTab('monitor');
    };
    const cmd = (
      id: string,
      label: string,
      run: () => void,
      opts: { shortcut?: string; disabled?: boolean; keywords?: string[] } = {},
    ): PaletteCommand => ({ id, group: 'actions', label, run, ...opts });
    const actions: (PaletteCommand | false)[] = [
      cmd(
        'run',
        run.ready && running ? t('shell:lab.controls.pause') : t('shell:lab.controls.run'),
        runOrPause,
        {
          shortcut: 'F5',
          disabled: run.phase === 'building',
        },
      ),
      cmd('step', t('shell:lab.controls.step'), step, { shortcut: 'F10', disabled: !run.ready || running }),
      cmd('stop', t('shell:editor.stop'), () => run.stop(), {
        shortcut: 'Shift+F5',
        disabled: run.phase !== 'live',
      }),
      cmd('reset', t('shell:lab.controls.reset'), resetRun, { shortcut: 'F6', disabled: !run.ready }),
      cmd('sound', t('shell:editor.sound'), sound.toggle),
      editing && cmd('save', t('shell:editor.save'), save, { shortcut: 'Ctrl+S' }),
      editing &&
        !cloudOpen &&
        cmd('new', t('shell:editor.new'), () => replace(starterProject(t('shell:editor.starterTitle')))),
      editing && cmd('import', t('shell:editor.import'), () => fileInput.current?.click()),
      cmd('export', t('shell:editor.export'), () => downloadProject(current)),
      editing &&
        !!cloudOpen &&
        cmd('versions', t('shell:cloud.versions.button'), () => setVersionsOpen(true)),
      editing && cloudOpen?.access === 'owner' && cmd('share', t('share:button'), () => setShareOpen(true)),
      editing &&
        !cloudOpen &&
        cmd('cloud', t('shell:cloud.saveToCloud'), () => void saveToCloud(), { disabled: uploading }),
      editing &&
        hasChassis(doc) &&
        cmd('arena', t('shell:arena.picker.choose'), () => setArenaPicker(true), { disabled: !circuit }),
      ...(editing
        ? SCENARIOS.map((v) =>
            cmd(`demo:${v}`, t('shell:palette.openDemo', { name: t(`shell:lab.scenario.${v}`) }), () =>
              openDemo(v),
            ),
          )
        : []),
      editing && cmd('format', t('shell:code.format'), () => codeTool('format'), { shortcut: 'Shift+Alt+F' }),
      editing && cmd('libraries', t('shell:code.libraries.open'), () => codeTool('libraries')),
      circuit &&
        cmd('undo', t('editor:actions.undo'), editor.undo, { shortcut: 'Ctrl+Z', disabled: !editor.canUndo }),
      circuit &&
        cmd('redo', t('editor:actions.redo'), editor.redo, { shortcut: 'Ctrl+Y', disabled: !editor.canRedo }),
      circuit &&
        cmd('copy', t('shell:palette.copy'), () => void copyParts(editor), {
          shortcut: 'Ctrl+C',
          disabled: !parts,
        }),
      circuit &&
        cmd('cut', t('shell:palette.cut'), () => void cutParts(editor), {
          shortcut: 'Ctrl+X',
          disabled: !parts,
        }),
      circuit &&
        cmd('paste', t('shell:palette.paste'), () => void pasteParts(editor), { shortcut: 'Ctrl+V' }),
      ...dockTabs.map((v) =>
        cmd(`dock:${v}`, t('shell:palette.showPanel', { name: t(`shell:editor.dock.${v}`) }), () =>
          openDock(v),
        ),
      ),
      cmd('help', t('shell:editor.shortcuts.title'), () => setHelp(true), { shortcut: 'F1' }),
      cmd('tour', t('shell:tour.start'), () => setTourOpen(true)),
    ];
    return actions.filter((c): c is PaletteCommand => c !== false);
  };
  useEffect(() => {
    openPalette.current = () => {
      const commands = paletteCommands();
      setPalette((open) => (open ? null : commands));
    };
  });

  const toolbar = (
    <div
      role="toolbar"
      aria-label={t('shell:editor.toolbar')}
      className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-surface-raised px-3 py-1.5"
    >
      <input
        aria-label={t('shell:editor.titleLabel')}
        key={doc.meta.title}
        defaultValue={doc.meta.title}
        readOnly={readOnly}
        maxLength={200}
        onBlur={(e) => {
          const title = e.target.value.trim();
          if (title && title !== doc.meta.title) editor.apply((d) => ({ ...d, meta: { ...d.meta, title } }));
        }}
        className="w-40 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-semibold hover:border-line focus:border-line"
      />
      {size !== 'narrow' && readOnly && (
        <Button size="sm" variant="secondary" onClick={() => downloadProject(current)}>
          {t('shell:editor.export')}
        </Button>
      )}
      {size !== 'narrow' && !readOnly && (
        <>
          {cloudOpen ? (
            <Link
              to="/projects"
              className="rounded-md border border-line bg-surface px-2 py-1 text-sm hover:bg-surface-raised"
            >
              {t('shell:cloud.allProjects')}
            </Link>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => replace(starterProject(t('shell:editor.starterTitle')))}
            >
              {t('shell:editor.new')}
            </Button>
          )}
          <select
            aria-label={t('shell:editor.demo')}
            value={demoChoice}
            onChange={(e) => setDemoChoice(e.target.value as ScenarioId)}
            className="rounded-md border border-line bg-surface px-1.5 py-1 text-sm"
          >
            {SCENARIOS.map((v) => (
              <option key={v} value={v}>
                {t(`shell:lab.scenario.${v}`)}
              </option>
            ))}
          </select>
          <Button size="sm" variant="secondary" onClick={() => openDemo(demoChoice)}>
            {t('shell:editor.open')}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => fileInput.current?.click()}>
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
          <Button size="sm" variant="secondary" onClick={() => downloadProject(current)}>
            {t('shell:editor.export')}
          </Button>
          <Button size="sm" variant="secondary" onClick={save} aria-keyshortcuts="Control+S">
            {t('shell:editor.save')}
          </Button>
          {cloudOpen ? (
            <>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setVersionsOpen(true)}
                aria-haspopup="dialog"
              >
                {t('shell:cloud.versions.button')}
              </Button>
              {cloudOpen.access === 'owner' && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setShareOpen(true)}
                  aria-haspopup="dialog"
                >
                  {t('share:button')}
                </Button>
              )}
            </>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => void saveToCloud()} disabled={uploading}>
              {t('shell:cloud.saveToCloud')}
            </Button>
          )}
          {hasChassis(doc) && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setArenaPicker(true)}
              disabled={canvasMode !== 'edit'}
              aria-haspopup="dialog"
            >
              {docArena
                ? t('shell:arena.picker.button', { name: t(`shell:arenas.${docArena.id}.name`) })
                : t('shell:arena.picker.choose')}
            </Button>
          )}
        </>
      )}
      <span aria-hidden className="mx-1 h-5 w-px bg-line" />
      <Button
        size="sm"
        data-tour="run"
        onClick={runOrPause}
        disabled={run.phase === 'building'}
        aria-busy={run.phase === 'building'}
        aria-keyshortcuts="F5"
      >
        {run.phase === 'building'
          ? queuedAt !== null
            ? t('shell:editor.queued', { position: queuedAt })
            : t('shell:editor.building')
          : run.ready && running
            ? t('shell:lab.controls.pause')
            : t('shell:lab.controls.run')}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={step}
        disabled={!run.ready || running}
        aria-keyshortcuts="F10"
      >
        {t('shell:lab.controls.step')}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => run.stop()}
        disabled={run.phase !== 'live'}
        aria-keyshortcuts="Shift+F5"
      >
        {t('shell:editor.stop')}
      </Button>
      <Button size="sm" variant="secondary" onClick={resetRun} disabled={!run.ready} aria-keyshortcuts="F6">
        {t('shell:lab.controls.reset')}
      </Button>
      <SegmentedControl
        label={t('shell:lab.controls.speed')}
        value={speed}
        options={SPEEDS.map((v) => ({ value: v, label: `${fmt(Number(v), v.includes('.') ? 2 : 0)}×` }))}
        onChange={setSpeed}
      />
      <Button size="sm" variant="secondary" aria-pressed={sound.enabled} onClick={sound.toggle}>
        <span aria-hidden>{sound.enabled ? '🔊 ' : '🔇 '}</span>
        {t('shell:editor.sound')}
      </Button>
      <p role="status" aria-live="polite" className="text-sm tabular-nums text-ink-muted">
        {status}
      </p>
      {cloudOpen && (
        <p
          role="status"
          aria-live="polite"
          title={cloud.message ?? undefined}
          className={cn(
            'rounded-full border px-2 text-xs',
            cloud.status === 'saved'
              ? 'border-line text-ink-muted'
              : cloud.status === 'error' || cloud.status === 'conflict'
                ? 'border-danger text-danger'
                : 'border-line text-ink',
          )}
        >
          {t(`shell:cloud.status.${cloud.status}`)}
        </p>
      )}
      <Button
        size="sm"
        variant="secondary"
        className="ms-auto"
        data-tour="help"
        onClick={() => setHelp(true)}
        aria-keyshortcuts="F1"
      >
        {t('shell:editor.help')}
      </Button>
    </div>
  );

  const alerts = (
    <>
      {viewer?.banner}
      {cloudOpen?.access === 'edit' && (
        <ShareBanner text={t('share:viewer.editBanner', { owner: cloudOpen.ownerName })} />
      )}
      {cloudOpen?.remixedFrom && (
        <ShareBanner
          text={t('share:remixedFrom', {
            name: cloudOpen.remixedFrom.name,
            author: cloudOpen.remixedFrom.author,
          })}
        />
      )}
      {(sim.error || sim.stalled) && run.phase !== 'edit' && (
        <p
          role="alert"
          className="flex items-center gap-2 border-b border-danger px-3 py-1 text-sm text-danger"
        >
          {sim.error ? t('shell:lab.error', { message: sim.error }) : t('shell:lab.stalled')}
          <Button
            size="sm"
            variant="secondary"
            className="ms-auto"
            onClick={() => {
              sim.restart();
              run.stop();
            }}
          >
            {t('shell:lab.restart')}
          </Button>
        </p>
      )}
      {notice && (
        <p role="status" className="flex items-center gap-2 border-b border-line px-3 py-1 text-sm">
          {notice}
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
    </>
  );

  const frameClass = '-m-6 flex h-[calc(100dvh-3.5rem)] flex-col overflow-hidden';
  const helpDialog = (
    <>
      {help && (
        <HelpDialog
          onClose={() => setHelp(false)}
          onTour={() => {
            setHelp(false);
            setTourOpen(true);
          }}
        />
      )}
      {tourOpen && <OnboardingTour onDone={finishTour} />}
      {palette && (
        <CommandPalette
          actions={palette}
          editor={canvasMode === 'edit' ? editor : undefined}
          onClose={() => setPalette(null)}
        />
      )}
      {shownPaywall && (
        <PaywallDialog
          reason={shownPaywall.reason}
          onClose={shownPaywall.close}
          actions={
            shownPaywall.reason.kind !== 'builds' && (
              <Button size="sm" variant="secondary" onClick={() => downloadProject(current)}>
                {t('plans:paywall.download')}
              </Button>
            )
          }
        />
      )}
      {cloud.conflict && (
        <ConflictDialog
          conflict={cloud.conflict}
          onResolve={async (keep) => {
            const next = await cloud.resolve(keep);
            if (next) load(next);
          }}
        />
      )}
      {shareOpen && cloudOpen && (
        <ShareDialog
          projectId={cloudOpen.id}
          name={doc.meta.title}
          projects={projects}
          onClose={() => setShareOpen(false)}
        />
      )}
      {versionsOpen && (
        <VersionsDialog
          cloud={cloud}
          onRestored={(next) => load(next)}
          onClose={() => setVersionsOpen(false)}
        />
      )}
      {arenaPicker && (
        <ArenaPicker
          current={arenaId}
          robot={docRobot}
          onPick={pickArena}
          onClose={() => setArenaPicker(false)}
        />
      )}
    </>
  );

  if (size !== 'wide') {
    const robotTab: MobileTab[] = robotProject ? ['robot'] : [];
    const guideTab: MobileTab[] = guidePane ? ['guide'] : [];
    const tabs: MobileTab[] =
      size === 'narrow'
        ? [...guideTab, 'circuit', ...robotTab, 'sim', 'monitor']
        : [
            ...guideTab,
            ...(readOnly ? [] : (['parts'] as const)),
            'circuit',
            ...robotTab,
            'code',
            'sim',
            'monitor',
          ];
    const tab = tabs.includes(mobileTab) ? mobileTab : 'circuit';
    return (
      <div className={frameClass}>
        <h1 className="sr-only">{t('shell:editor.title')}</h1>
        {toolbar}
        {alerts}
        {size === 'narrow' && (
          <p role="note" className="border-b border-line bg-surface-raised px-3 py-1.5 text-sm">
            {t('shell:editor.narrow')}
          </p>
        )}
        <div className="px-3 py-1.5">
          <SegmentedControl
            label={t('shell:editor.panes')}
            value={tab}
            options={tabs.map((v) => ({
              value: v,
              label:
                v === 'circuit'
                  ? titles.canvas
                  : v === 'robot'
                    ? titles.robot
                    : v === 'parts'
                      ? titles.left
                      : v === 'monitor'
                        ? titles.dock
                        : titles[v],
            }))}
            onChange={setMobileTab}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {tab === 'guide'
            ? guidePane
            : tab === 'circuit'
              ? canvas
              : tab === 'robot'
                ? robotPane
                : tab === 'parts'
                  ? leftPane
                  : tab === 'code'
                    ? codePane
                    : tab === 'sim'
                      ? simPane
                      : dock}
        </div>
        {helpDialog}
      </div>
    );
  }

  const { collapsed } = layout;
  return (
    <div className={frameClass}>
      <h1 className="sr-only">{t('shell:editor.title')}</h1>
      {toolbar}
      {alerts}
      <div className="flex min-h-0 flex-1">
        {guidePane &&
          (collapsed.guide ? (
            <Rail title={titles.guide} vertical onExpand={() => toggle('guide')} />
          ) : (
            <>
              <PaneFrame title={titles.guide} onCollapse={() => toggle('guide')} className="shrink-0">
                <div style={{ width: layout.guide }} className="h-full">
                  {guidePane}
                </div>
              </PaneFrame>
              <ResizeHandle
                orientation="vertical"
                side="start"
                label={t('shell:editor.pane.resize', { pane: titles.guide })}
                value={layout.guide}
                min={240}
                max={560}
                onChange={(v) => resize({ guide: v })}
              />
            </>
          ))}
        {readOnly ? null : collapsed.left ? (
          <Rail title={titles.left} vertical onExpand={() => toggle('left')} />
        ) : (
          <>
            <PaneFrame
              title={titles.left}
              onCollapse={() => toggle('left')}
              className="shrink-0"
              tour="parts"
            >
              <div style={{ width: layout.left }} className="h-full">
                {leftPane}
              </div>
            </PaneFrame>
            <ResizeHandle
              orientation="vertical"
              side="start"
              label={t('shell:editor.pane.resize', { pane: titles.left })}
              value={layout.left}
              min={180}
              max={480}
              onChange={(v) => resize({ left: v })}
            />
          </>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <PaneFrame
            title={showRobot ? titles.robot : titles.canvas}
            tour="circuit"
            className="flex-1"
            actions={
              <>
                {centreSwitch}
                <button
                  type="button"
                  onClick={editor.undo}
                  disabled={!editor.canUndo || canvasMode !== 'edit'}
                  className="rounded px-1.5 hover:bg-surface-raised disabled:opacity-40"
                >
                  {t('editor:actions.undo')}
                </button>
                <button
                  type="button"
                  onClick={editor.redo}
                  disabled={!editor.canRedo || canvasMode !== 'edit'}
                  className="rounded px-1.5 hover:bg-surface-raised disabled:opacity-40"
                >
                  {t('editor:actions.redo')}
                </button>
              </>
            }
          >
            {showRobot ? robotPane : canvas}
          </PaneFrame>
          {doc.arena &&
            (collapsed.sim ? (
              <Rail title={titles.sim} vertical={false} onExpand={() => toggle('sim')} />
            ) : (
              <>
                <ResizeHandle
                  orientation="horizontal"
                  side="end"
                  label={t('shell:editor.pane.resize', { pane: titles.sim })}
                  value={layout.sim}
                  min={160}
                  max={720}
                  onChange={(v) => resize({ sim: v })}
                />
                <div style={{ height: layout.sim }} className="flex shrink-0 flex-col">
                  <PaneFrame title={titles.sim} onCollapse={() => toggle('sim')} className="h-full">
                    {simPane}
                  </PaneFrame>
                </div>
              </>
            ))}
        </div>
        {collapsed.code ? (
          <Rail title={titles.code} vertical onExpand={() => toggle('code')} />
        ) : (
          <>
            <ResizeHandle
              orientation="vertical"
              side="end"
              label={t('shell:editor.pane.resize', { pane: titles.code })}
              value={layout.code}
              min={260}
              max={900}
              onChange={(v) => resize({ code: v })}
            />
            <div style={{ width: layout.code }} className="flex shrink-0 flex-col">
              <PaneFrame title={titles.code} onCollapse={() => toggle('code')} className="h-full" tour="code">
                {codePane}
              </PaneFrame>
            </div>
          </>
        )}
      </div>
      {collapsed.dock ? (
        <Rail title={titles.dock} vertical={false} onExpand={() => toggle('dock')} />
      ) : (
        <>
          <ResizeHandle
            orientation="horizontal"
            side="end"
            label={t('shell:editor.pane.resize', { pane: titles.dock })}
            value={layout.dock}
            min={120}
            max={600}
            onChange={(v) => resize({ dock: v })}
          />
          <div style={{ height: layout.dock }} className="flex shrink-0 flex-col">
            <PaneFrame
              title={titles.dock}
              onCollapse={() => toggle('dock')}
              className="h-full"
              tour="monitor"
            >
              {dock}
            </PaneFrame>
          </div>
        </>
      )}
      {helpDialog}
    </div>
  );
}
