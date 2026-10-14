import {
  BENCH_SCENARIOS,
  SAFETY_SCENARIOS,
  type BenchScenarioId,
  type SafetyScenarioId,
  type ScenarioId,
} from '@robosim/sim-runtime';
import { Button, SegmentedControl } from '@robosim/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArenaView } from './arena-view.js';
import { BenchView } from './bench-view.js';
import { FindingsPanel } from './findings-panel.js';
import { useFormat } from './format.js';
import { PinTable } from './pin-table.js';
import { Telemetry } from './telemetry.js';
import { useSimulation, type WorkerLike } from './use-simulation.js';

type Tab = 'arena' | 'bench' | 'safety';
const TABS = ['arena', 'bench', 'safety'] as const;
const SPEEDS = ['0.5', '1', '2', '4'] as const;

/** Simulator Lab: live engine demos, extended with every engine slice (Release Plan P1). */
export function LabPage({ createWorker }: { createWorker?: () => WorkerLike }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const { scene, frame, error, send } = useSimulation(createWorker);
  const [tab, setTab] = useState<Tab>('arena');
  const [bench, setBench] = useState<BenchScenarioId>('blink');
  const [safety, setSafety] = useState<SafetyScenarioId>('led-no-resistor');
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>('1');
  const scenario: ScenarioId = tab === 'arena' ? 'line-follower' : tab === 'bench' ? bench : safety;

  useEffect(() => {
    send({ type: 'load', scenario });
    send({ type: 'control', action: 'run' });
  }, [scenario, send]);

  useEffect(() => send({ type: 'speed', value: Number(speed) }), [speed, send]);

  const running = frame?.running ?? false;
  const ready = scene?.scenario === scenario;

  return (
    <div className="mx-auto max-w-6xl py-8">
      <h1 className="text-2xl font-bold tracking-tight">{t('shell:lab.title')}</h1>
      <p className="mt-2 max-w-3xl text-ink-muted">{t('shell:lab.intro')}</p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <SegmentedControl
          label={t('shell:lab.tabsLabel')}
          value={tab}
          options={TABS.map((v) => ({ value: v, label: t(`shell:lab.tabs.${v}`) }))}
          onChange={setTab}
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
      </div>
      <p className="mt-3 text-sm text-ink-muted">{t(`shell:lab.scenarioHint.${scenario}`)}</p>

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
        <SegmentedControl
          label={t('shell:lab.controls.speed')}
          value={speed}
          options={SPEEDS.map((v) => ({ value: v, label: `${fmt(Number(v), v === '0.5' ? 1 : 0)}×` }))}
          onChange={setSpeed}
        />
        <p role="status" aria-live="off" className="ms-auto text-sm tabular-nums text-ink-muted">
          {!ready
            ? t('shell:lab.status.loading')
            : `${t('shell:lab.status.time', { seconds: fmt(frame?.simTime ?? 0, 2) })} · ${
                running
                  ? t('shell:lab.status.rtf', { factor: fmt(frame?.rtf ?? 0, 2) })
                  : t('shell:lab.status.paused')
              }`}
        </p>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-md border border-danger p-3 text-sm text-danger">
          {t('shell:lab.error', { message: error })}
        </p>
      )}

      {ready && scene && (
        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_16rem]">
          <div>
            {scene.kind === 'arena' ? (
              <ArenaView scene={scene} frame={frame} label={t(`shell:lab.scenario.${scenario}`)} />
            ) : (
              <BenchView scene={scene} frame={frame} send={send} />
            )}
          </div>
          <div className="flex flex-col gap-3">
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
