import { Button, Card, cn } from '@robosim/ui';
import type { Frame, MainToWorker, PartInfo, SceneInfo } from '@robosim/sim-runtime/client';
import { useTranslation } from 'react-i18next';
import { useFormat } from './format.js';

type Send = (m: MainToWorker) => void;

const LED_COLORS: Record<string, string> = {
  red: '#ef4444',
  yellow: '#facc15',
  green: '#22c55e',
  blue: '#3b82f6',
  white: '#f8fafc',
};

function LedWidget({
  state,
}: {
  state: { color: string; brightness: number; currentMa: number } | undefined;
}) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const color = LED_COLORS[state?.color ?? 'red'] ?? '#ef4444';
  const b = state?.brightness ?? 0;
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden
        className="size-10 rounded-full border border-line"
        style={{
          backgroundColor: color,
          opacity: 0.15 + 0.85 * b,
          boxShadow: b > 0.05 ? `0 0 ${8 + 24 * b}px ${color}` : 'none',
        }}
      />
      <span className="text-sm tabular-nums">
        {t('shell:lab.telemetry.milliamps', { value: fmt(state?.currentMa ?? 0, 1) })}
      </span>
    </div>
  );
}

function ButtonWidget({ part, send }: { part: PartInfo; send: Send }) {
  const { t } = useTranslation();
  const press = (value: boolean) => send({ type: 'input', componentId: part.id, name: 'pressed', value });
  return (
    <Button
      variant="secondary"
      onPointerDown={() => press(true)}
      onPointerUp={() => press(false)}
      onPointerLeave={() => press(false)}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') press(true);
      }}
      onKeyUp={() => press(false)}
    >
      {t('shell:lab.parts.hold')}
    </Button>
  );
}

function KnobWidget({
  part,
  state,
  send,
}: {
  part: PartInfo;
  state: { position: number; wiperV: number } | undefined;
  send: Send;
}) {
  const { t } = useTranslation();
  const fmt = useFormat();
  // Slider to the end = wiper at the 5 V end (position 0), so "more" reads as more voltage.
  const value = Math.round((1 - (state?.position ?? 0.5)) * 100);
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-ink-muted">{t('shell:lab.parts.knob')}</span>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) =>
          send({
            type: 'input',
            componentId: part.id,
            name: 'position',
            value: 1 - Number(e.target.value) / 100,
          })
        }
      />
      <span className="tabular-nums">
        {t('shell:lab.telemetry.volts', { value: fmt(state?.wiperV ?? 0, 2) })}
      </span>
    </label>
  );
}

function ServoWidget({ state }: { state: { angleDeg: number; pulseUs: number | null } | undefined }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const a = ((state?.angleDeg ?? 90) * Math.PI) / 180;
  // 0° points right, 180° left, like the horn seen from above.
  const x = 50 + 38 * Math.cos(Math.PI - a);
  const y = 55 - 38 * Math.sin(Math.PI - a);
  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 100 60" className="h-16 w-28" aria-hidden>
        <path
          d="M 10 55 A 40 40 0 0 1 90 55"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.25"
          strokeWidth="2"
        />
        <line x1="50" y1="55" x2={x} y2={y} stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
        <circle cx="50" cy="55" r="5" fill="currentColor" />
      </svg>
      <div className="text-sm tabular-nums">
        <p>{t('shell:lab.parts.angle', { value: fmt(state?.angleDeg ?? 0) })}</p>
        <p className="text-ink-muted">
          {state?.pulseUs
            ? t('shell:lab.parts.pulse', { value: fmt(state.pulseUs) })
            : t('shell:lab.parts.noSignal')}
        </p>
      </div>
    </div>
  );
}

function ResistorWidget({ state }: { state: { currentMa: number } | undefined }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  return (
    <span className="text-sm tabular-nums">
      {t('shell:lab.telemetry.milliamps', { value: fmt(state?.currentMa ?? 0, 1) })}
    </span>
  );
}

/** One card per part of the bench circuit, with an interactive widget where the part takes input. */
export function BenchView({ scene, frame, send }: { scene: SceneInfo; frame: Frame | null; send: Send }) {
  const { t } = useTranslation();
  const widget = (part: PartInfo) => {
    const state = frame?.parts[part.id] as never;
    switch (part.type) {
      case 'actuator.led':
        return <LedWidget state={state} />;
      case 'sensor.push-button':
        return <ButtonWidget part={part} send={send} />;
      case 'passive.potentiometer':
        return <KnobWidget part={part} state={state} send={send} />;
      case 'actuator.sg90-servo':
        return <ServoWidget state={state} />;
      case 'passive.resistor':
        return <ResistorWidget state={state} />;
      default:
        return null;
    }
  };
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {scene.parts.map((part) => {
        const damaged = frame?.damaged.parts.includes(part.id) ?? false;
        return (
          <Card key={part.id} className={cn('p-4', damaged && 'border-danger')}>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              {t(`components:${part.type}.name`)}
              {damaged && (
                <span className="rounded bg-danger px-1.5 py-0.5 text-xs font-semibold text-white">
                  <span aria-hidden>💥 </span>
                  {t('shell:lab.damaged')}
                </span>
              )}
            </h3>
            <div className={cn(damaged && 'opacity-50')}>{widget(part)}</div>
          </Card>
        );
      })}
    </div>
  );
}
