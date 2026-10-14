import type { Frame, SceneInfo } from '@robosim/sim-runtime';
import { Card } from '@robosim/ui';
import { useTranslation } from 'react-i18next';
import { useFormat } from './format.js';

export function PinTable({ scene, frame }: { scene: SceneInfo; frame: Frame | null }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  return (
    <Card className="p-3">
      <h2 className="mb-2 text-sm font-semibold text-ink-muted">{t('shell:lab.pins.title')}</h2>
      <table className="w-full text-sm tabular-nums">
        <thead className="text-start text-xs text-ink-muted">
          <tr>
            <th className="pe-3 text-start font-medium">{t('shell:lab.pins.pin')}</th>
            <th className="pe-3 text-start font-medium">{t('shell:lab.pins.mode')}</th>
            <th className="pe-3 text-start font-medium">{t('shell:lab.pins.value')}</th>
          </tr>
        </thead>
        <tbody>
          {scene.pins.map((pin) => {
            const p = frame?.pins[pin];
            return (
              <tr key={pin} className="border-t border-line">
                <td className="py-1 pe-3 font-mono">
                  <span dir="ltr">{pin}</span>
                </td>
                <td className="py-1 pe-3">{p ? t(`shell:lab.pinMode.${p.mode}`) : '—'}</td>
                <td className="flex flex-wrap items-baseline gap-x-1.5 py-1">
                  {p?.duty !== undefined
                    ? t('shell:lab.pins.duty', { value: fmt(p.duty * 100) })
                    : p
                      ? p.level
                        ? 'HIGH'
                        : 'LOW'
                      : '—'}
                  {frame?.damaged.pins.includes(pin) && (
                    <span className="text-xs font-semibold text-danger">
                      <span aria-hidden>💥 </span>
                      {t('shell:lab.pinDamaged')}
                    </span>
                  )}
                  {p && (
                    <span className="text-xs text-ink-muted">
                      {t('shell:lab.telemetry.volts', { value: fmt(p.volts, 2) })}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
