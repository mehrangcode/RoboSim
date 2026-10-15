import type { MainToWorker } from '@robosim/sim-runtime/client';
import { Button, Card } from '@robosim/ui';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

/** Arduino IDE-style Serial Monitor: firmware output plus a line to send to the UART (FR-SIM serial). */
export function SerialMonitor({ output, send }: { output: string; send: (m: MainToWorker) => void }) {
  const { t } = useTranslation();
  const [line, setLine] = useState('');
  const log = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [output]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!line) return;
    send({ type: 'serial', text: `${line}\n` });
    setLine('');
  };

  return (
    <Card className="p-3">
      <h2 className="mb-2 text-sm font-semibold text-ink-muted">{t('shell:lab.serial.title')}</h2>
      <pre
        ref={log}
        dir={output ? 'ltr' : undefined}
        aria-label={t('shell:lab.serial.output')}
        className="h-40 overflow-y-auto whitespace-pre-wrap break-all rounded-md border border-line p-2 font-mono text-xs"
      >
        {output.replace(/\r\n?/g, '\n') || t('shell:lab.serial.empty')}
      </pre>
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
        <Button size="sm" type="submit" disabled={!line}>
          {t('shell:lab.serial.send')}
        </Button>
      </form>
    </Card>
  );
}
