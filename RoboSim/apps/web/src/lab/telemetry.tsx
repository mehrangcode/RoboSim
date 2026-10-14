import { Card, cn } from '@robosim/ui';
import type { Frame } from '@robosim/sim-runtime';
import { useTranslation } from 'react-i18next';
import { useFormat } from './format.js';

const MOTORS = [
  { id: 'motorL', label: 'motorLeft' },
  { id: 'motorR', label: 'motorRight' },
] as const;
const CHANNELS = ['left', 'center', 'right'] as const;

interface Motor {
  rpm: number;
  currentMa: number;
}
interface Line {
  outputs: { left: 0 | 1; center: 0 | 1; right: 0 | 1 };
}
interface Battery {
  volts: number;
  charge: number;
  currentMa: number;
}
interface Driver {
  bridgeA: string;
  bridgeB: string;
}

function Stat({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-3">
      <h3 className="text-xs font-medium text-ink-muted">{title}</h3>
      <div className="mt-1 text-sm tabular-nums">{children}</div>
    </Card>
  );
}

/** Live readings of the line-follower robot. */
export function Telemetry({ frame }: { frame: Frame | null }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const part = <T,>(id: string) => frame?.parts[id] as T | undefined;
  const motor = (id: string, label: string) => {
    const m = part<Motor>(id);
    return (
      <Stat key={id} title={t(`shell:lab.telemetry.${label}`)}>
        <p>{t('shell:lab.telemetry.rpm', { value: fmt(m?.rpm ?? 0) })}</p>
        <p className="text-ink-muted">
          {t('shell:lab.telemetry.milliamps', { value: fmt(m?.currentMa ?? 0) })}
        </p>
      </Stat>
    );
  };
  const line = part<Line>('line');
  const bat = part<Battery>('bat');
  const drv = part<Driver>('drv');
  return (
    <section aria-labelledby="telemetry-title">
      <h2 id="telemetry-title" className="mb-2 text-sm font-semibold text-ink-muted">
        {t('shell:lab.telemetry.title')}
      </h2>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
        {MOTORS.map((m) => motor(m.id, m.label))}
        <Stat title={t('shell:lab.telemetry.lineSensor')}>
          <div className="flex gap-1.5" dir="ltr">
            {CHANNELS.map((ch) => (
              <span
                key={ch}
                className={cn(
                  'inline-flex size-7 items-center justify-center rounded text-xs font-semibold',
                  line?.outputs[ch] ? 'bg-ink text-surface' : 'border border-line text-ink-muted',
                )}
              >
                {t(`shell:lab.telemetry.${ch}`)}
              </span>
            ))}
          </div>
        </Stat>
        <Stat title={t('shell:lab.telemetry.battery')}>
          <p>{t('shell:lab.telemetry.volts', { value: fmt(bat?.volts ?? 0, 2) })}</p>
          <p className="text-ink-muted">
            {t('shell:lab.telemetry.percent', { value: fmt((bat?.charge ?? 0) * 100, 1) })} ·{' '}
            {t('shell:lab.telemetry.milliamps', { value: fmt(bat?.currentMa ?? 0) })}
          </p>
        </Stat>
        <Stat title={t('shell:lab.telemetry.driver')}>
          <p>
            {t(`shell:lab.bridge.${drv?.bridgeA ?? 'coast'}`)} /{' '}
            {t(`shell:lab.bridge.${drv?.bridgeB ?? 'coast'}`)}
          </p>
        </Stat>
      </div>
    </section>
  );
}
