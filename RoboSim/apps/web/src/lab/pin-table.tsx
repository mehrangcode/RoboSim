import type { Frame, PinView, SceneInfo } from '@robosim/sim-runtime/client';
import { Card, cn } from '@robosim/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormat } from './format.js';

/** What `analogRead` returns for a voltage on the Uno (10-bit ADC, 5 V reference). */
const adcReading = (volts: number) => Math.min(1023, Math.max(0, Math.floor((volts / 5) * 1024)));

/** D0…D13 then A0…A5, numerically. */
const pinOrder = (pin: string) => (pin.startsWith('A') ? 100 : 0) + Number(pin.slice(1));

/**
 * Live pin inspector (FR-SIM-06): every Uno I/O pin with its mode, level, PWM duty and frequency,
 * and voltage. Pins with nothing wired are dimmed and can be hidden; floating inputs are flagged.
 */
export function PinTable({
  scene,
  frame,
  bare = false,
}: {
  scene: SceneInfo;
  frame: Frame | null;
  bare?: boolean;
}) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const [showUnwired, setShowUnwired] = useState(true);
  const live = frame?.pins ?? {};
  const all = [...new Set([...scene.pins, ...Object.keys(live)])].sort((a, b) => pinOrder(a) - pinOrder(b));
  const pins = showUnwired ? all : all.filter((pin) => !live[pin]?.unwired);

  const value = (p: PinView) =>
    p.duty !== undefined
      ? p.freqHz !== undefined
        ? t('shell:lab.pins.pwm', { duty: fmt(p.duty * 100), freq: fmt(p.freqHz, 0) })
        : t('shell:lab.pins.duty', { value: fmt(p.duty * 100) })
      : p.level
        ? 'HIGH'
        : 'LOW';

  const body = (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {!bare && (
          <h2 className="me-auto text-sm font-semibold text-ink-muted">{t('shell:lab.pins.title')}</h2>
        )}
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={showUnwired} onChange={(e) => setShowUnwired(e.target.checked)} />
          {t('shell:lab.pins.showUnwired')}
        </label>
      </div>
      <table className="w-full text-sm tabular-nums">
        <thead className="text-start text-xs text-ink-muted">
          <tr>
            <th className="pe-3 text-start font-medium">{t('shell:lab.pins.pin')}</th>
            <th className="pe-3 text-start font-medium">{t('shell:lab.pins.mode')}</th>
            <th className="pe-3 text-start font-medium">{t('shell:lab.pins.value')}</th>
            <th className="text-start font-medium">{t('shell:lab.pins.voltage')}</th>
          </tr>
        </thead>
        <tbody>
          {pins.map((pin) => {
            const p = live[pin];
            return (
              <tr key={pin} className={cn('border-t border-line', p?.unwired && 'text-ink-muted')}>
                <td className="py-1 pe-3 font-mono">
                  <span dir="ltr">{pin}</span>
                </td>
                <td className="py-1 pe-3">{p ? t(`shell:lab.pinMode.${p.mode}`) : '—'}</td>
                <td className="py-1 pe-3">
                  <span className="flex flex-wrap items-baseline gap-x-1.5">
                    {p?.floating ? t('shell:lab.pins.floating') : p ? value(p) : '—'}
                    {p && pin.startsWith('A') && p.mode !== 'output' && !p.unwired && (
                      <span className="text-xs text-ink-muted">
                        {t('shell:lab.pins.adc', { value: fmt(adcReading(p.volts), 0) })}
                      </span>
                    )}
                    {frame?.damaged.pins.includes(pin) && (
                      <span className="text-xs font-semibold text-danger">
                        <span aria-hidden>💥 </span>
                        {t('shell:lab.pinDamaged')}
                      </span>
                    )}
                    {p?.unwired && <span className="text-xs">{t('shell:lab.pins.unwired')}</span>}
                  </span>
                </td>
                <td className="py-1">
                  {p && !p.floating ? t('shell:lab.telemetry.volts', { value: fmt(p.volts, 2) }) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
  return bare ? <div>{body}</div> : <Card className="p-3">{body}</Card>;
}
