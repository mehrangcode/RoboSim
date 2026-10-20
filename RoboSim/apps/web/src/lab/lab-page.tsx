import {
  BENCH_SCENARIOS,
  MAX_SIM_SECONDS,
  SAFETY_SCENARIOS,
  type BenchScenarioId,
  type SafetyScenarioId,
  type ScenarioId,
  type SourceFile,
} from '@robosim/sim-runtime/client';
import { Button, SegmentedControl } from '@robosim/ui';
import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ArenaView } from '../arena/arena-view.js';
import { BenchView } from './bench-view.js';
import { ChallengePanel } from './challenge-panel.js';
import { FindingsPanel } from './findings-panel.js';
import { useFormat } from './format.js';
import { PinTable } from './pin-table.js';
import { SerialMonitor } from './serial-monitor.js';
import { SketchPanel } from './sketch-panel.js';
import { Telemetry } from './telemetry.js';
import { useBuild, type CompileSketch } from './use-build.js';
import { useSimulation, type WorkerLike } from './use-simulation.js';
import { useVerifiedRun, type GradeWorkerLike } from './use-verified-run.js';
import { VerifyPanel } from './verify-panel.js';

type Tab = 'arena' | 'bench' | 'safety' | 'sketch';
const TABS = ['arena', 'bench', 'safety', 'sketch'] as const;
/** Demos whose circuit the sketch tab can run the learner's own code on. */
const TEMPLATES = ['line-follower', ...BENCH_SCENARIOS] as const;
type Template = (typeof TEMPLATES)[number];
const SPEEDS = ['0.5', '1', '2', '4'] as const;

/** Simulator Lab: live engine demos, extended with every engine slice (Release Plan P1). */
export function LabPage({
  createWorker,
  createGradeWorker,
  compileSketch,
}: {
  createWorker?: () => WorkerLike;
  createGradeWorker?: () => GradeWorkerLike;
  compileSketch?: CompileSketch;
}) {
  const { t, i18n } = useTranslation();
  const fmt = useFormat();
  const {
    scene,
    frame,
    error,
    stalled,
    restart,
    serial,
    serialLog,
    clearSerial,
    replaying,
    send,
    exportLog,
  } = useSimulation(createWorker);
  const verified = useVerifiedRun(createGradeWorker);
  const [tab, setTab] = useState<Tab>('arena');
  const [bench, setBench] = useState<BenchScenarioId>('blink');
  const [safety, setSafety] = useState<SafetyScenarioId>('led-no-resistor');
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>('1');
  const [template, setTemplate] = useState<Template>('blink');
  const scenario: ScenarioId =
    tab === 'arena' ? 'line-follower' : tab === 'bench' ? bench : tab === 'safety' ? safety : template;

  // Sketch tab: the template's own files, the learner's edits, and whether their firmware is running.
  const build = useBuild(compileSketch);
  const [originals, setOriginals] = useState<Partial<Record<Template, readonly SourceFile[]>>>({});
  const [drafts, setDrafts] = useState<Partial<Record<Template, string>>>({});
  const [userRun, setUserRun] = useState(false);
  const mainFile = originals[template]?.find((f) => f.name.endsWith('.ino'));
  const draft = drafts[template] ?? mainFile?.content ?? '';
  const sketchFiles = (originals[template] ?? []).map((f) => (f === mainFile ? { ...f, content: draft } : f));

  // Remember each template's own files the first time its scene arrives (state derived during render).
  const sceneTemplate = TEMPLATES.find((v) => v === scene?.scenario);
  if (scene && sceneTemplate && !originals[sceneTemplate])
    setOriginals({ ...originals, [sceneTemplate]: scene.code });

  const clearVerified = verified.clear;
  const clearBuild = build.clear;
  useEffect(() => {
    clearVerified();
    clearBuild();
    send({ type: 'load', scenario });
    send({ type: 'control', action: 'run' });
  }, [scenario, send, clearVerified, clearBuild]);

  /** Compiles the edited sketch with the build service and runs the firmware on the template's circuit. */
  const compileAndRun = async () => {
    const files = sketchFiles;
    const compiled = await build.build({ board: 'avr-uno', files: [...files], libraries: [] }, i18n.language);
    const artifact = compiled?.result.artifact;
    if (!compiled?.hex || !artifact) return;
    clearVerified();
    setUserRun(true);
    send({
      type: 'load',
      template,
      files,
      firmware: { format: 'ihex', text: compiled.hex, sha256: artifact.sha256 },
    });
    send({ type: 'control', action: 'run' });
  };

  useEffect(() => send({ type: 'speed', value: Number(speed) }), [speed, send]);

  /** Saves the input log of this run: with the same engine version it reproduces the run exactly. */
  const download = async () => {
    const log = await exportLog();
    const url = URL.createObjectURL(new Blob([JSON.stringify(log, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `robosim-${log.scenario}-seed${log.seed}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /** Re-runs this scenario from the start, replaying every input at the slice it happened. */
  const replay = async () => {
    const log = await exportLog();
    const source = log.scenario
      ? { scenario: log.scenario }
      : { project: log.project, firmware: log.firmware };
    send({ type: 'load', ...source, seed: log.seed, inputLog: log.entries });
    send({ type: 'control', action: 'run' });
  };

  /** Pauses, then grades this run up to the same slice in a worker of its own, as the grader would. */
  const verify = async () => {
    send({ type: 'control', action: 'pause' });
    const log = await exportLog();
    if (!log.endSlice) return;
    verified.verify({ log, maxSimSeconds: Math.min(log.endSlice / 1000, MAX_SIM_SECONDS) });
  };

  const running = frame?.running ?? false;
  const ready = scene !== null && (userRun ? scene.scenario === null : scene.scenario === scenario);

  return (
    <div className="mx-auto max-w-6xl py-8">
      <h1 className="text-2xl font-bold tracking-tight">{t('shell:lab.title')}</h1>
      <p className="mt-2 max-w-3xl text-ink-muted">{t('shell:lab.intro')}</p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <SegmentedControl
          label={t('shell:lab.tabsLabel')}
          value={tab}
          options={TABS.map((v) => ({ value: v, label: t(`shell:lab.tabs.${v}`) }))}
          onChange={(v) => {
            setUserRun(false);
            setTab(v);
          }}
        />
        {tab === 'bench' && (
          <SegmentedControl
            label={t('shell:lab.scenarioLabel')}
            value={bench}
            options={BENCH_SCENARIOS.map((v) => ({ value: v, label: t(`shell:lab.scenario.${v}`) }))}
            onChange={setBench}
          />
        )}
        {tab === 'safety' && (
          <SegmentedControl
            label={t('shell:lab.scenarioLabel')}
            value={safety}
            options={SAFETY_SCENARIOS.map((v) => ({ value: v, label: t(`shell:lab.scenario.${v}`) }))}
            onChange={setSafety}
          />
        )}
        {tab === 'sketch' && (
          <SegmentedControl
            label={t('shell:lab.sketch.templateLabel')}
            value={template}
            options={TEMPLATES.map((v) => ({ value: v, label: t(`shell:lab.scenario.${v}`) }))}
            onChange={(v) => {
              setUserRun(false);
              setTemplate(v);
            }}
          />
        )}
      </div>
      <p className="mt-3 text-sm text-ink-muted">
        {tab === 'sketch' ? t('shell:lab.sketch.hint') : t(`shell:lab.scenarioHint.${scenario}`)}{' '}
        <Link to="/editor" search={{ demo: scenario }} className="font-medium text-brand-600 hover:underline">
          {t('shell:lab.openInEditor')}
        </Link>
      </p>

      {tab === 'sketch' && mainFile && (
        <div className="mt-4">
          <SketchPanel
            files={sketchFiles}
            // Demo sketches are one .ino; the Lab edits just that (multi-file projects live in /editor).
            onChange={(name, code) =>
              name === mainFile.name && setDrafts((d) => ({ ...d, [template]: code }))
            }
            onCompile={() => void compileAndRun()}
            onRestore={() => {
              setDrafts(({ [template]: _, ...rest }) => rest);
              build.clear();
            }}
            state={build.state}
            modified={draft !== mainFile.content}
          />
        </div>
      )}

      <div
        role="toolbar"
        aria-label={t('shell:lab.controls.label')}
        className="mt-4 flex flex-wrap items-center gap-2"
      >
        <Button
          size="sm"
          onClick={() => send({ type: 'control', action: running ? 'pause' : 'run' })}
          disabled={!ready}
        >
          {running ? t('shell:lab.controls.pause') : t('shell:lab.controls.run')}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => send({ type: 'control', action: 'reset' })}
          disabled={!ready}
        >
          {t('shell:lab.controls.reset')}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => send({ type: 'control', action: 'step' })}
          disabled={!ready || running}
        >
          {t('shell:lab.controls.step')}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => void replay()} disabled={!ready}>
          {t('shell:lab.controls.replay')}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => void download()} disabled={!ready}>
          {t('shell:lab.controls.exportLog')}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void verify()}
          disabled={!ready || !frame?.simTime || verified.state.status === 'grading'}
        >
          {t('shell:lab.controls.verify')}
        </Button>
        <SegmentedControl
          label={t('shell:lab.controls.speed')}
          value={speed}
          options={SPEEDS.map((v) => ({ value: v, label: `${fmt(Number(v), v === '0.5' ? 1 : 0)}×` }))}
          onChange={setSpeed}
        />
        <p role="status" aria-live="off" className="ms-auto text-sm tabular-nums text-ink-muted">
          {!ready
            ? t('shell:lab.status.loading')
            : [
                t('shell:lab.status.time', { seconds: fmt(frame?.simTime ?? 0, 2) }),
                running
                  ? t('shell:lab.status.rtf', { factor: fmt(frame?.rtf ?? 0, 2) })
                  : t('shell:lab.status.paused'),
                ...(replaying > 0 ? [t('shell:lab.status.replaying', { count: replaying })] : []),
              ].join(' · ')}
        </p>
      </div>

      {(error || stalled) && (
        <p
          role="alert"
          className="mt-4 flex items-center gap-2 rounded-md border border-danger p-3 text-sm text-danger"
        >
          {error ? t('shell:lab.error', { message: error }) : t('shell:lab.stalled')}
          <Button size="sm" variant="secondary" className="ms-auto" onClick={restart}>
            {t('shell:lab.restart')}
          </Button>
        </p>
      )}

      {ready && scene && (
        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_16rem]">
          <div>
            {scene.kind === 'arena' && scene.arena ? (
              <ArenaView
                arena={scene.arena}
                robot={scene.robot ?? null}
                frame={frame}
                project={scene.project}
                label={scene.scenario ? t(`shell:lab.scenario.${scene.scenario}`) : scene.title}
              />
            ) : (
              <BenchView scene={scene} frame={frame} send={send} />
            )}
            {scene.serial && (
              <div className="mt-4">
                <SerialMonitor log={serialLog} send={send} onClear={clearSerial} />
              </div>
            )}
          </div>
          <div className="flex flex-col gap-3">
            <VerifyPanel state={verified.state} frame={frame} serial={serial} />
            {frame?.challenge && <ChallengePanel challenge={frame.challenge} send={send} />}
            {scene.kind === 'arena' && <Telemetry frame={frame} />}
            <PinTable scene={scene} frame={frame} />
            <FindingsPanel
              findings={[...scene.staticFindings, ...(frame?.findings ?? [])]}
              partTypes={Object.fromEntries(scene.parts.map((p) => [p.id, p.type]))}
            />
          </div>
        </div>
      )}
    </div>
  );
}
