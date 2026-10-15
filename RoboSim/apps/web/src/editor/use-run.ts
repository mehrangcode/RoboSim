import type { ProjectDocument } from '@robosim/shared';
import type { MainToWorker, SceneInfo, ScenarioId } from '@robosim/sim-runtime/client';
import { useCallback, useState } from 'react';
import { useBuild, type CompileSketch } from '../lab/use-build.js';
import { runKey } from './project-store.js';

/**
 * The workspace's Run model: Run compiles when the project changed since the last build (an
 * unchanged demo runs its prebuilt firmware), loads it into the worker and starts it. Any edit
 * to the circuit or code stops the run, so the simulation always matches what is drawn.
 */
export type RunPhase = 'edit' | 'building' | 'live';

/** A demo opened in the editor, as loaded: running it unchanged needs no build service. */
export interface OpenedDemo {
  readonly id: ScenarioId;
  readonly key: string;
}

export function useRun({
  send,
  scene,
  compileSketch,
  locale,
}: {
  send: (m: MainToWorker) => void;
  scene: SceneInfo | null;
  compileSketch?: CompileSketch | undefined;
  locale: string;
}) {
  const build = useBuild(compileSketch);
  const [phase, setPhase] = useState<RunPhase>('edit');
  /** runKey of the project in the worker, and which scene id it reports (null for a project). */
  const [loaded, setLoaded] = useState<{ key: string; scenario: ScenarioId | null } | null>(null);
  const [demo, setDemo] = useState<OpenedDemo | null>(null);
  const [stoppedByEdit, setStoppedByEdit] = useState(false);
  /** Firmware per build input, so Run after Stop does not rebuild an unchanged sketch. */
  const [firmware, setFirmware] = useState<{ key: string; text: string; sha256: string } | null>(null);

  const ready = phase === 'live' && loaded !== null && scene !== null && scene.scenario === loaded.scenario;

  const stop = useCallback(
    (byEdit = false) => {
      send({ type: 'control', action: 'pause' });
      setPhase('edit');
      setStoppedByEdit(byEdit);
    },
    [send],
  );

  /** Watches the project: an edit while live stops the run (state derived during render). */
  const watch = (doc: ProjectDocument) => {
    if (phase === 'live' && loaded && runKey(doc) !== loaded.key) stop(true);
  };

  const start = async (doc: ProjectDocument, running: boolean) => {
    const key = runKey(doc);
    setStoppedByEdit(false);
    if (phase === 'live' && loaded?.key === key) {
      send({ type: 'control', action: running ? 'pause' : 'run' });
      return;
    }
    if (demo && demo.key === key) {
      setLoaded({ key, scenario: demo.id });
      setPhase('live');
      send({ type: 'load', scenario: demo.id });
      send({ type: 'control', action: 'run' });
      return;
    }
    const codeKey = JSON.stringify(doc.code.files);
    let fw = firmware?.key === codeKey ? firmware : null;
    if (!fw) {
      setPhase('building');
      const compiled = await build.build(
        { board: 'avr-uno', files: doc.code.files.map((f) => ({ ...f })), libraries: [] },
        locale,
      );
      const artifact = compiled?.result.artifact;
      if (!compiled?.hex || !artifact) {
        setPhase('edit');
        return;
      }
      fw = { key: codeKey, text: compiled.hex, sha256: artifact.sha256 };
      setFirmware(fw);
    } else build.clear();
    setLoaded({ key, scenario: null });
    setPhase('live');
    send({ type: 'load', project: doc, firmware: { format: 'ihex', text: fw.text, sha256: fw.sha256 } });
    send({ type: 'control', action: 'run' });
  };

  return {
    phase,
    ready,
    build: build.state,
    clearBuild: build.clear,
    stoppedByEdit,
    demo,
    setDemo,
    start,
    stop,
    watch,
  };
}
