import {
  CircuitCanvas,
  LibraryPanel,
  PropertyPanel,
  useCircuitEditor,
  type CanvasMode,
} from '@robosim/circuit-canvas';
import { ProjectDocumentError, parseProjectDocument, type ProjectDocument } from '@robosim/shared';
import { SCENARIOS, type ScenarioId, type SourceFile } from '@robosim/sim-runtime/client';
import { Button, ResizeHandle, SegmentedControl, cn } from '@robosim/ui';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArenaView } from '../lab/arena-view.js';
import { ChallengePanel } from '../lab/challenge-panel.js';
import { FindingsPanel } from '../lab/findings-panel.js';
import { useFormat } from '../lab/format.js';
import { PinTable } from '../lab/pin-table.js';
import { SerialMonitor } from '../lab/serial-monitor.js';
import { SketchPanel } from '../lab/sketch-panel.js';
import type { CompileSketch } from '../lab/use-build.js';
import { useSimulation, type WorkerLike } from '../lab/use-simulation.js';
import { HelpDialog } from './help-dialog.js';
import {
  downloadJson,
  fileName,
  loadStored,
  mainFile,
  runKey,
  saveStored,
  withFiles,
} from './project-store.js';
import { starterProject } from './starter.js';
import { useLayout, useSizeClass, type Pane } from './use-layout.js';
import { useRun } from './use-run.js';

const SPEEDS = ['0.25', '0.5', '1', '2', '4'] as const;
type DockTab = 'serial' | 'pins' | 'safety' | 'challenge';
type MobileTab = 'parts' | 'circuit' | 'code' | 'sim' | 'monitor';

/** A pane with a title bar and a collapse button. */
function PaneFrame({
  title,
  onCollapse,
  actions,
  children,
  className,
}: {
  title: string;
  onCollapse?: () => void;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <section aria-label={title} className={cn('flex min-h-0 min-w-0 flex-col bg-surface', className)}>
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

/**
 * The editor workspace (FR-WRK-01…03): component library and properties, circuit canvas with the
 * simulation view, code, and a bottom dock with serial monitor, pin inspector, safety and challenge.
 */
export function EditorPage({
  createWorker,
  compileSketch,
}: {
  createWorker?: () => WorkerLike;
  compileSketch?: CompileSketch;
}) {
  const { t, i18n } = useTranslation();
  const fmt = useFormat();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { demo?: string };
  const sim = useSimulation(createWorker);
  const { scene, frame, serialLog, clearSerial, send } = sim;
  const [stored] = useState(loadStored);
  const editor = useCircuitEditor(() => stored?.project ?? starterProject(t('shell:editor.starterTitle')));
  const { doc, reset } = editor;
  const [files, setFiles] = useState<readonly SourceFile[]>(() => doc.code.files);
  const [pristine, setPristine] = useState(() => stored?.pristine ?? runKey(doc));
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>('1');
  const [demoChoice, setDemoChoice] = useState<ScenarioId>('blink');
  /** Demo asked for, until the worker's scene delivers its document. */
  const opening = useRef<ScenarioId | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dockTab, setDockTab] = useState<DockTab>('serial');
  const [mobileTab, setMobileTab] = useState<MobileTab>('circuit');
  const [help, setHelp] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const { layout, resize, toggle } = useLayout();
  const size = useSizeClass();
  const run = useRun({ send, scene, compileSketch, locale: i18n.language });
  const current = withFiles(doc, files);
  const running = frame?.running ?? false;

  // Autosave on every change; an edit while running stops the run.
  useEffect(() => {
    saveStored({ project: current, pristine });
  });
  const { watch } = run;
  useEffect(() => watch(current));
  useEffect(() => send({ type: 'speed', value: Number(speed) }), [speed, send]);

  /** Replaces the project after confirming when the current one has edits of its own. */
  const replace = (next: ProjectDocument, demoId: ScenarioId | null = null) => {
    if (runKey(current) !== pristine && !window.confirm(t('shell:editor.confirmReplace'))) return false;
    if (run.phase !== 'edit') run.stop();
    reset(next);
    setFiles(next.code.files);
    setPristine(runKey(next));
    run.setDemo(demoId ? { id: demoId, key: runKey(next) } : null);
    run.clearBuild();
    setNotice(null);
    return true;
  };

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
    if (!requested) return;
    openDemo(requested);
    void navigate({ to: '/editor', search: {}, replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per requested demo
  }, [requested]);

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const json = JSON.parse(await file.text()) as Record<string, unknown>;
      // An exported input log carries its project too.
      replace(parseProjectDocument('project' in json ? json['project'] : json));
    } catch (err) {
      setNotice(
        t('shell:editor.importError', {
          message:
            err instanceof ProjectDocumentError ? err.issues.slice(0, 3).join('; ') : (err as Error).message,
        }),
      );
    }
  };

  const save = () =>
    setNotice(
      saveStored({ project: current, pristine }) ? t('shell:editor.saved') : t('shell:editor.saveFailed'),
    );
  const runOrPause = () => void run.start(current, running);
  const step = () => run.ready && !running && send({ type: 'control', action: 'step' });
  const resetRun = () => run.ready && send({ type: 'control', action: 'reset' });

  // Keyboard shortcuts (FR-WRK-02).
  const keys = useRef({ runOrPause, stop: () => {}, step, resetRun, save });
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
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const live = run.ready ? frame : null;
  const canvasMode: CanvasMode = run.phase === 'live' ? 'run' : size === 'narrow' ? 'view' : 'edit';
  const findings = live && scene ? [...scene.staticFindings, ...live.findings] : [];
  const status =
    run.phase === 'building'
      ? t('shell:editor.status.building')
      : run.ready && live
        ? [
            t('shell:lab.status.time', { seconds: fmt(live.simTime, 2) }),
            running ? t('shell:lab.status.rtf', { factor: fmt(live.rtf, 2) }) : t('shell:lab.status.paused'),
          ].join(' · ')
        : run.stoppedByEdit
          ? t('shell:editor.status.stoppedByEdit')
          : t('shell:editor.status.editing');

  const titles: Record<Pane | 'canvas', string> = {
    left: t('shell:editor.pane.parts'),
    canvas: t('shell:editor.pane.circuit'),
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
      onChange={(name, content) => setFiles((fs) => fs.map((f) => (f.name === name ? { ...f, content } : f)))}
      onFilesChange={setFiles}
      state={run.build}
      modified={current !== doc}
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
    live && scene?.kind === 'arena' ? (
      <ArenaView scene={scene} frame={live} label={scene.title} className="block h-full w-full" />
    ) : (
      <p className="p-3 text-sm text-ink-muted">
        {doc.arena ? t('shell:editor.sim.notRunning') : t('shell:editor.sim.bench')}
      </p>
    );
  const dockTabs: DockTab[] = [
    'serial',
    'pins',
    'safety',
    ...(live?.challenge ? (['challenge'] as const) : []),
  ];
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
        {!live || !scene ? (
          <p className="text-sm text-ink-muted">{t('shell:editor.dock.notRunning')}</p>
        ) : dockTab === 'pins' ? (
          <PinTable bare scene={scene} frame={live} />
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
        maxLength={200}
        onBlur={(e) => {
          const title = e.target.value.trim();
          if (title && title !== doc.meta.title) editor.apply((d) => ({ ...d, meta: { ...d.meta, title } }));
        }}
        className="w-40 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-semibold hover:border-line focus:border-line"
      />
      {size !== 'narrow' && (
        <>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => replace(starterProject(t('shell:editor.starterTitle')))}
          >
            {t('shell:editor.new')}
          </Button>
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
            accept="application/json,.json"
            className="hidden"
            aria-label={t('shell:editor.import')}
            onChange={(e) => {
              void importFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <Button size="sm" variant="secondary" onClick={() => downloadJson(fileName(current), current)}>
            {t('shell:editor.export')}
          </Button>
          <Button size="sm" variant="secondary" onClick={save}>
            {t('shell:editor.save')}
          </Button>
        </>
      )}
      <span aria-hidden className="mx-1 h-5 w-px bg-line" />
      <Button
        size="sm"
        onClick={runOrPause}
        disabled={run.phase === 'building'}
        aria-busy={run.phase === 'building'}
        aria-keyshortcuts="F5"
      >
        {run.phase === 'building'
          ? t('shell:editor.building')
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
      <p role="status" aria-live="polite" className="text-sm tabular-nums text-ink-muted">
        {status}
      </p>
      <Button
        size="sm"
        variant="secondary"
        className="ms-auto"
        onClick={() => setHelp(true)}
        aria-keyshortcuts="F1"
      >
        {t('shell:editor.help')}
      </Button>
    </div>
  );

  const alerts = (
    <>
      {sim.error && run.phase !== 'edit' && (
        <p role="alert" className="border-b border-danger px-3 py-1 text-sm text-danger">
          {t('shell:lab.error', { message: sim.error })}
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
  const helpDialog = help && <HelpDialog onClose={() => setHelp(false)} />;

  if (size !== 'wide') {
    const tabs: MobileTab[] =
      size === 'narrow' ? ['circuit', 'sim', 'monitor'] : ['parts', 'circuit', 'code', 'sim', 'monitor'];
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
          {tab === 'circuit'
            ? canvas
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
        {collapsed.left ? (
          <Rail title={titles.left} vertical onExpand={() => toggle('left')} />
        ) : (
          <>
            <PaneFrame title={titles.left} onCollapse={() => toggle('left')} className="shrink-0">
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
            title={titles.canvas}
            className="flex-1"
            actions={
              <>
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
            {canvas}
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
              <PaneFrame title={titles.code} onCollapse={() => toggle('code')} className="h-full">
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
            <PaneFrame title={titles.dock} onCollapse={() => toggle('dock')} className="h-full">
              {dock}
            </PaneFrame>
          </div>
        </>
      )}
      {helpDialog}
    </div>
  );
}
