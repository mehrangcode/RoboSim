import {
  SERIAL_BAUD_RATES,
  decodeSerial,
  type MainToWorker,
  type SerialLog,
} from '@robosim/sim-runtime/client';
import { Button, Card, SegmentedControl } from '@robosim/ui';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { formatSliceTime } from './format.js';
import { SerialPlotter } from './serial-plotter.js';

const LINE_ENDINGS = { none: '', nl: '\n', cr: '\r', both: '\r\n' } as const;
type LineEnding = keyof typeof LINE_ENDINGS;

interface MonitorSettings {
  readonly baud: number;
  readonly lineEnding: LineEnding;
  readonly timestamps: boolean;
  /** Text monitor or plotter (FR-SIM-07). */
  readonly view: 'text' | 'plot';
}

const SETTINGS_KEY = 'robosim.serial.v1';
// Arduino IDE 2 defaults.
const DEFAULTS: MonitorSettings = { baud: 9600, lineEnding: 'nl', timestamps: false, view: 'text' };

function loadSettings(): MonitorSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as Partial<MonitorSettings> | null;
    return {
      baud: SERIAL_BAUD_RATES.includes(raw?.baud as never) ? (raw?.baud ?? DEFAULTS.baud) : DEFAULTS.baud,
      lineEnding: raw?.lineEnding && raw.lineEnding in LINE_ENDINGS ? raw.lineEnding : DEFAULTS.lineEnding,
      timestamps: raw?.timestamps === true,
      view: raw?.view === 'plot' ? 'plot' : 'text',
    };
  } catch {
    return DEFAULTS;
  }
}

/**
 * Arduino IDE-style Serial Monitor (FR-SIM-07): the monitor decodes the raw UART bytes at its own
 * baud, so a rate that differs from `Serial.begin` shows garbage, as on real hardware, plus a hint.
 * The plotter view draws the same decoded lines as series.
 */
export function SerialMonitor({
  log,
  send,
  onClear,
  bare = false,
}: {
  log: SerialLog;
  send: (m: MainToWorker) => void;
  onClear?: () => void;
  /** Without the card frame and title (inside the editor dock). */
  bare?: boolean;
}) {
  const { t } = useTranslation();
  const [line, setLine] = useState('');
  const [settings, setSettings] = useState(loadSettings);
  const [autoscroll, setAutoscroll] = useState(true);
  const out = useRef<HTMLPreElement>(null);

  const update = (patch: Partial<MonitorSettings>) =>
    setSettings((s) => {
      const next = { ...s, ...patch };
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch {
        // Storage unavailable (private mode): settings last for the session.
      }
      return next;
    });

  const { version } = log;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` marks in-place appends to the log.
  const decoded = useMemo(() => decodeSerial(log.chunks, settings.baud), [log, version, settings.baud]);

  useEffect(() => {
    const el = out.current;
    if (el && autoscroll) el.scrollTop = el.scrollHeight;
  }, [decoded, autoscroll, settings.timestamps]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = line + LINE_ENDINGS[settings.lineEnding];
    if (!text) return;
    send({ type: 'serial', text });
    setLine('');
  };

  const text = decoded.lines
    .map((l) => (settings.timestamps ? `${formatSliceTime(l.slice)} -> ${l.text}` : l.text))
    .join('\n');
  const select = 'rounded-md border border-line bg-surface px-1.5 py-0.5 text-xs';

  const body = (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
        {!bare && (
          <h2 className="me-auto text-sm font-semibold text-ink-muted">{t('shell:lab.serial.title')}</h2>
        )}
        <SegmentedControl
          label={t('shell:lab.serial.view')}
          value={settings.view}
          options={[
            { value: 'text', label: t('shell:lab.serial.text') },
            { value: 'plot', label: t('shell:lab.serial.plot') },
          ]}
          onChange={(view) => update({ view })}
        />
        <label className="flex items-center gap-1">
          {t('shell:lab.serial.baud')}
          <select
            dir="ltr"
            className={select}
            value={settings.baud}
            onChange={(e) => update({ baud: Number(e.target.value) })}
          >
            {SERIAL_BAUD_RATES.map((rate) => (
              <option key={rate} value={rate}>
                {rate}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          {t('shell:lab.serial.lineEnding')}
          <select
            className={select}
            value={settings.lineEnding}
            onChange={(e) => update({ lineEnding: e.target.value as LineEnding })}
          >
            {(Object.keys(LINE_ENDINGS) as LineEnding[]).map((k) => (
              <option key={k} value={k}>
                {t(`shell:lab.serial.ending.${k}`)}
              </option>
            ))}
          </select>
        </label>
        {settings.view === 'text' && (
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={settings.timestamps}
              onChange={(e) => update({ timestamps: e.target.checked })}
            />
            {t('shell:lab.serial.timestamps')}
          </label>
        )}
        {settings.view === 'text' && (
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={autoscroll} onChange={(e) => setAutoscroll(e.target.checked)} />
            {t('shell:lab.serial.autoscroll')}
          </label>
        )}
        {onClear && (
          <Button size="sm" variant="ghost" onClick={onClear} disabled={!decoded.lines.length}>
            {t('shell:lab.serial.clear')}
          </Button>
        )}
      </div>
      {decoded.mismatch && decoded.sketchBaud !== null && (
        <p
          role="status"
          className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-danger/50 px-2 py-1 text-xs"
        >
          <span>
            {t('shell:lab.serial.mismatch', {
              sketch: decoded.sketchBaud,
              monitor: settings.baud,
            })}
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => update({ baud: decoded.sketchBaud ?? DEFAULTS.baud })}
          >
            {t('shell:lab.serial.useBaud', { baud: decoded.sketchBaud })}
          </Button>
        </p>
      )}
      {settings.view === 'plot' ? (
        <SerialPlotter lines={decoded.lines} partial={decoded.partial} />
      ) : (
        <pre
          ref={out}
          dir={text ? 'ltr' : undefined}
          aria-label={t('shell:lab.serial.output')}
          aria-live="off"
          // No ligatures: `->` must not render as `→`.
          className="h-40 overflow-y-auto whitespace-pre-wrap break-all rounded-md border border-line p-2 font-mono text-xs [font-variant-ligatures:none]"
        >
          {text || t('shell:lab.serial.empty')}
        </pre>
      )}
      <form onSubmit={submit} className="mt-2 flex gap-2">
        <input
          // Serial text is LTR; the empty field keeps the page direction so the placeholder reads right.
          dir={line ? 'ltr' : undefined}
          value={line}
          onChange={(e) => setLine(e.target.value)}
          aria-label={t('shell:lab.serial.input')}
          placeholder={t('shell:lab.serial.placeholder')}
          className="min-w-0 flex-1 rounded-md border border-line bg-transparent px-2 py-1 font-mono text-sm placeholder:font-sans"
        />
        <Button size="sm" type="submit" disabled={!line && settings.lineEnding === 'none'}>
          {t('shell:lab.serial.send')}
        </Button>
      </form>
    </>
  );
  return bare ? <div>{body}</div> : <Card className="p-3">{body}</Card>;
}
