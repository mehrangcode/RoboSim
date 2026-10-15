import { CircuitEditor, useCircuitEditor } from '@robosim/circuit-canvas';
import { ProjectDocumentError, parseProjectDocument, type ProjectDocument } from '@robosim/shared';
import {
  BENCH_SCENARIOS,
  SAFETY_SCENARIOS,
  type Frame,
  type MainToWorker,
  type SceneInfo,
  type ScenarioId,
} from '@robosim/sim-runtime/client';
import { Button, Card } from '@robosim/ui';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { starterProject } from './design-starter.js';
import { SketchPanel } from './sketch-panel.js';
import { useBuild, type CompileSketch } from './use-build.js';

/** What the Design tab last put into the simulator: the designed project or an opened demo. */
export type DesignLoaded = 'project' | ScenarioId | null;

const DEMOS: readonly ScenarioId[] = ['line-follower', ...BENCH_SCENARIOS, ...SAFETY_SCENARIOS];
const STORAGE_KEY = 'robosim.lab.design.v1';

function restore(): ProjectDocument | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? parseProjectDocument(JSON.parse(saved)) : null;
  } catch {
    return null; // unreadable or from an incompatible version: start fresh
  }
}

const mainFile = (doc: ProjectDocument) => doc.code.files.find((f) => f.name.endsWith('.ino'));

/** Download a JSON file (project document). */
function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * The Lab's Design tab (slice 11): draw a circuit on the breadboard canvas, write its sketch, then
 * compile and run exactly that project. Autosaved in this browser; import/export as JSON.
 */
export function DesignPanel({
  scene,
  frame,
  send,
  loaded,
  onLoad,
  compileSketch,
}: {
  scene: SceneInfo | null;
  frame: Frame | null;
  send: (message: MainToWorker) => void;
  loaded: DesignLoaded;
  onLoad: (what: DesignLoaded) => void;
  compileSketch?: CompileSketch | undefined;
}) {
  const { t, i18n } = useTranslation();
  const editor = useCircuitEditor(() => restore() ?? starterProject(t('shell:lab.design.starterTitle')));
  const { doc, reset } = editor;
  const [code, setCode] = useState(() => mainFile(doc)?.content ?? '');
  const [demo, setDemo] = useState<ScenarioId>('blink');
  const [opening, setOpening] = useState<ScenarioId | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const build = useBuild(compileSketch);
  /** The document of the last run, to tell when the canvas has moved on from it. */
  const [ran, setRan] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const withCode = (d: ProjectDocument): ProjectDocument => {
    const main = mainFile(d);
    return main
      ? {
          ...d,
          code: { ...d.code, files: d.code.files.map((f) => (f === main ? { ...f, content: code } : f)) },
        }
      : d;
  };
  const current = withCode(doc);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch {
      // Storage full or disabled: the design still lives in memory.
    }
  });

  const open = (next: ProjectDocument) => {
    reset(next);
    setCode(mainFile(next)?.content ?? '');
    build.clear();
    setImportError(null);
  };

  // A demo opens once the worker has loaded it: its scene carries the document.
  if (opening && scene?.scenario === opening) {
    setOpening(null);
    open(scene.project);
    setRan(JSON.stringify(scene.project));
  }

  const openDemo = () => {
    setOpening(demo);
    onLoad(demo);
    send({ type: 'load', scenario: demo });
    send({ type: 'control', action: 'run' });
  };

  const importFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const json = JSON.parse(await file.text()) as Record<string, unknown>;
      // An exported input log carries its project too.
      open(parseProjectDocument('project' in json ? json['project'] : json));
    } catch (err) {
      setImportError(
        err instanceof ProjectDocumentError ? err.issues.slice(0, 3).join('; ') : (err as Error).message,
      );
    }
  };

  const compileAndRun = async () => {
    const project = current;
    const compiled = await build.build(
      { board: 'avr-uno', files: project.code.files.map((f) => ({ ...f })), libraries: [] },
      i18n.language,
    );
    const artifact = compiled?.result.artifact;
    if (!compiled?.hex || !artifact) return;
    setRan(JSON.stringify(project));
    onLoad('project');
    send({
      type: 'load',
      project,
      firmware: { format: 'ihex', text: compiled.hex, sha256: artifact.sha256 },
    });
    send({ type: 'control', action: 'run' });
  };

  const main = mainFile(doc);
  const showing = loaded !== null && scene !== null;
  const stale = showing && ran !== null && ran !== JSON.stringify(current);

  return (
    <div className="mt-4 flex flex-col gap-4">
      <div
        role="toolbar"
        aria-label={t('shell:lab.design.toolbar')}
        className="flex flex-wrap items-center gap-2"
      >
        <Button
          size="sm"
          variant="secondary"
          onClick={() => open(starterProject(t('shell:lab.design.starterTitle')))}
        >
          {t('shell:lab.design.new')}
        </Button>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-ink-muted">{t('shell:lab.design.demo')}</span>
          <select
            value={demo}
            onChange={(e) => setDemo(e.target.value as ScenarioId)}
            className="rounded-md border border-line bg-surface px-2 py-1 text-sm"
          >
            {DEMOS.map((v) => (
              <option key={v} value={v}>
                {t(`shell:lab.scenario.${v}`)}
              </option>
            ))}
          </select>
        </label>
        <Button size="sm" variant="secondary" onClick={openDemo} disabled={opening !== null}>
          {t('shell:lab.design.open')}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => fileInput.current?.click()}>
          {t('shell:lab.design.import')}
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          aria-label={t('shell:lab.design.import')}
          onChange={(e) => void importFile(e)}
        />
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            download(`${current.meta.title.replace(/[^\w-]+/g, '-') || 'project'}.robosim.json`, current)
          }
        >
          {t('shell:lab.design.export')}
        </Button>
        {stale && (
          <p role="status" className="ms-auto text-sm text-ink-muted">
            {t('shell:lab.design.stale')}
          </p>
        )}
      </div>
      {importError && (
        <p role="alert" className="rounded-md border border-danger p-2 text-sm text-danger">
          {t('shell:lab.design.importError', { message: importError })}
        </p>
      )}

      <Card className="p-3">
        <CircuitEditor editor={editor} live={showing ? frame?.parts : undefined} />
      </Card>

      {main && (
        <SketchPanel
          fileName={main.name}
          code={code}
          onChange={setCode}
          onCompile={() => void compileAndRun()}
          onRestore={() => {
            setCode(main.content);
            build.clear();
          }}
          state={build.state}
          modified={code !== main.content}
        />
      )}
    </div>
  );
}
