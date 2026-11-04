import {
  serialLines,
  verifiedLines,
  type DiffLine,
  type SerialArchive,
  type SerialDiff,
} from '@robosim/sim-runtime/client';
import { Button, cn } from '@robosim/ui';
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormat } from './format.js';
import { diffSerialAsync } from './run-diff.js';
import { parseSerialImport } from './serial-export.js';

/** A log to compare (Technical Design §18.5): `timed` lines carry the slice they were sent in. */
export interface SerialSource {
  readonly lines: readonly DiffLine[];
  readonly timed: boolean;
  readonly truncated: boolean;
  /** Live lines sent at another rate than the monitor's: a text divergence is likely the baud. */
  readonly baudDiffers?: boolean;
}

export type SourceId = 'live' | 'previous' | 'verified' | 'file';

const ROWS_SHOWN = 300;

interface Row {
  readonly a?: number;
  readonly b?: number;
  readonly kind: 'equal' | 'timing' | 'removed' | 'added' | 'changed';
}

/** Ops to rows: a run of removed lines followed by added ones is shown side by side as changed. */
function toRows(diff: SerialDiff): Row[] {
  const rows: Row[] = [];
  const ops = diff.ops ?? [];
  for (let i = 0; i < ops.length;) {
    const op = ops[i];
    if (!op) break;
    if (op.kind === 'equal') {
      rows.push({ a: op.a, b: op.b, kind: op.timing ? 'timing' : 'equal' });
      i++;
      continue;
    }
    const removed: number[] = [];
    const added: number[] = [];
    for (let o = ops[i]; o?.kind === 'removed'; o = ops[++i]) removed.push(o.a);
    for (let o = ops[i]; o?.kind === 'added'; o = ops[++i]) added.push(o.b);
    for (let k = 0; k < Math.max(removed.length, added.length); k++) {
      const a = removed[k];
      const b = added[k];
      rows.push({
        ...(a !== undefined ? { a } : {}),
        ...(b !== undefined ? { b } : {}),
        kind: a !== undefined && b !== undefined ? 'changed' : a !== undefined ? 'removed' : 'added',
      });
    }
  }
  return rows;
}

const MARK = { equal: '', timing: '⏱', removed: '−', added: '+', changed: '±' } as const;
const SIDES = ['a', 'b'] as const;
const SAME_MARK = '✓ ';
const DIFF_MARK = '✗ ';

/**
 * Serial diff (FR-SIM-21): two logs side by side (stacked when narrow), the first divergence marked
 * and reachable with one button. Differences carry a symbol and a text label, not colour only; the
 * log text stays LTR on an RTL page.
 */
export function SerialDiffPanel({
  archive,
  previous,
  verified,
  monitorBaud,
  initial,
}: {
  archive: SerialArchive;
  previous: SerialArchive | null;
  verified: readonly { readonly slice: number; readonly text: string }[] | null;
  monitorBaud: number;
  /** Sources to start with (the panel is keyed by the request that opened it). */
  initial?: { readonly a: SourceId; readonly b: SourceId };
}) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const ids: SourceId[] = [
    'live',
    ...(previous ? ['previous' as const] : []),
    ...(verified ? ['verified' as const] : []),
    'file',
  ];
  const fallback = { a: previous ? 'previous' : 'live', b: verified ? 'verified' : 'live' } as const;
  const [sel, setSel] = useState<{ a: SourceId; b: SourceId }>(() => ({
    a: initial && ids.includes(initial.a) ? initial.a : fallback.a,
    b: initial && ids.includes(initial.b) ? initial.b : previous || verified ? fallback.b : 'file',
  }));
  const [files, setFiles] = useState<{
    a?: SerialSource & { name: string };
    b?: SerialSource & { name: string };
  }>({});
  const [fileError, setFileError] = useState<string | null>(null);
  const [ignoreTiming, setIgnoreTiming] = useState(false);
  const [tolerance, setTolerance] = useState(0);

  const { version } = archive;
  const live = useMemo((): SerialSource => {
    const lines = serialLines(archive.chunks, monitorBaud);
    return {
      lines,
      timed: true,
      truncated: archive.truncated,
      baudDiffers: lines.some((l) => l.baud !== 0 && l.baud !== monitorBaud),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` marks in-place appends.
  }, [archive, version, monitorBaud]);
  const prev = useMemo(
    (): SerialSource | null =>
      previous && {
        lines: serialLines(previous.chunks, monitorBaud),
        timed: true,
        truncated: previous.truncated,
      },
    [previous, monitorBaud],
  );
  const ver = useMemo(
    (): SerialSource | null => verified && { lines: verifiedLines(verified), timed: true, truncated: false },
    [verified],
  );
  const source = (side: 'a' | 'b'): SerialSource | null => {
    const id = sel[side];
    return id === 'live' ? live : id === 'previous' ? prev : id === 'verified' ? ver : (files[side] ?? null);
  };
  const A = source('a');
  const B = source('b');

  // The result is kept with the inputs it was computed for, so a stale one reads as "comparing".
  const inputs = useMemo(
    () => (A && B ? { A, B, opts: { ignoreTiming, timingToleranceMs: tolerance } } : null),
    [A, B, ignoreTiming, tolerance],
  );
  const [result, setResult] = useState<{ for: typeof inputs; diff: SerialDiff } | null>(null);
  useEffect(() => {
    if (!inputs) return;
    const ctl = new AbortController();
    void diffSerialAsync(inputs.A.lines, inputs.B.lines, inputs.opts, ctl.signal).then(
      (d) => d && setResult({ for: inputs, diff: d }),
    );
    return () => ctl.abort();
  }, [inputs]);
  const diff = inputs && result?.for === inputs ? result.diff : null;

  const rows = useMemo(() => (diff ? toRows(diff) : []), [diff]);
  const first = diff?.firstDivergence ?? null;
  const firstRow = useMemo(
    () => (first ? rows.findIndex((r) => r.a === first.lineA || r.b === first.lineB) : -1),
    [rows, first],
  );
  // The shown page belongs to one diff: a new diff starts at the top.
  const [page, setPage] = useState<{ diff: SerialDiff | null; start: number }>({ diff: null, start: 0 });
  const start = page.diff === diff ? page.start : 0;
  const setStart = (s: number) => setPage({ diff, start: s });
  // Row to focus once rendered (the row's ref callback takes it).
  const focusRow = useRef<number | null>(null);
  const jump = () => {
    if (firstRow < 0) return;
    focusRow.current = firstRow;
    setStart(Math.max(0, firstRow - 10));
  };

  const pick = (side: 'a' | 'b') => (e: ChangeEvent<HTMLSelectElement>) =>
    setSel((s) => ({ ...s, [side]: e.target.value as SourceId }));
  const load = (side: 'a' | 'b') => async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const log = parseSerialImport(await file.text());
      setFiles((f) => ({ ...f, [side]: { ...log, name: file.name } }));
      setFileError(null);
    } catch {
      setFileError(file.name);
    }
  };
  const sourceLabel = (id: SourceId) => t(`shell:lab.serialDiff.source.${id}`);
  const timedBoth = !!A?.timed && !!B?.timed;
  const kindLabel = (k: Row['kind']) => t(`shell:lab.serialDiff.kind.${k}`);
  const selectCls = 'rounded-md border border-line bg-surface px-1.5 py-0.5 text-xs';

  const cell = (src: SerialSource | null, i: number | undefined, side: 'a' | 'b') => {
    const line = i !== undefined ? src?.lines[i] : undefined;
    return (
      <div className="flex min-w-0 gap-2" data-side={side}>
        <span className="w-10 shrink-0 text-end text-ink-muted tabular-nums">
          {i !== undefined ? fmt(i + 1) : ''}
        </span>
        {src?.timed && (
          <span className="w-16 shrink-0 text-end text-ink-muted tabular-nums">
            {line?.slice !== undefined
              ? t('shell:lab.serialDiff.seconds', { s: fmt(line.slice / 1000, 3) })
              : ''}
          </span>
        )}
        <span
          dir="ltr"
          className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono [font-variant-ligatures:none]"
        >
          {line?.text ?? ''}
        </span>
      </div>
    );
  };

  const shown = rows.slice(start, start + ROWS_SHOWN);
  return (
    <div className="@container flex flex-col gap-2 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {SIDES.map((side) => (
          <div key={side} className="flex flex-wrap items-center gap-1">
            <label className="flex items-center gap-1">
              {t(`shell:lab.serialDiff.side.${side}`)}
              <select className={selectCls} value={sel[side]} onChange={pick(side)}>
                {ids.map((id) => (
                  <option key={id} value={id}>
                    {sourceLabel(id)}
                  </option>
                ))}
              </select>
            </label>
            {sel[side] === 'file' && (
              <label className="flex items-center gap-1">
                <span className="sr-only">
                  {t('shell:lab.serialDiff.chooseFile', { side: t(`shell:lab.serialDiff.side.${side}`) })}
                </span>
                <input
                  type="file"
                  accept=".txt,.csv,text/plain,text/csv"
                  onChange={load(side)}
                  className="max-w-48 text-xs"
                />
              </label>
            )}
          </div>
        ))}
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={ignoreTiming} onChange={(e) => setIgnoreTiming(e.target.checked)} />
          {t('shell:lab.serialDiff.ignoreTiming')}
        </label>
        <label className="flex items-center gap-1">
          {t('shell:lab.serialDiff.tolerance')}
          <input
            type="number"
            min={0}
            step={1}
            value={tolerance}
            disabled={ignoreTiming || !timedBoth}
            onChange={(e) => setTolerance(Math.max(0, Number(e.target.value) || 0))}
            className="w-16 rounded-md border border-line bg-transparent px-1 py-0.5"
          />
        </label>
      </div>
      {fileError && (
        <p role="alert" className="text-danger">
          {t('shell:lab.serialDiff.fileError', { name: fileError })}
        </p>
      )}

      <div role="status" className="flex flex-wrap items-center gap-2">
        {!A || !B ? (
          <span className="text-ink-muted">{t('shell:lab.serialDiff.pick')}</span>
        ) : !diff ? (
          <span>{t('shell:lab.serialDiff.comparing')}</span>
        ) : !first ? (
          <span className="font-semibold text-ok">
            <span aria-hidden>{SAME_MARK}</span>
            {t('shell:lab.serialDiff.identical', { count: A.lines.length, n: fmt(A.lines.length) })}
          </span>
        ) : (
          <>
            <span className="font-semibold text-danger">
              <span aria-hidden>{DIFF_MARK}</span>
              {t(`shell:lab.serialDiff.first.${first.reason}`, {
                a: fmt(first.lineA + 1),
                b: fmt(first.lineB + 1),
                column: fmt(first.column + 1),
              })}
            </span>
            {!diff.tooLarge && (
              <span className="text-ink-muted">
                {t('shell:lab.serialDiff.counts', {
                  added: fmt(diff.counts.added),
                  removed: fmt(diff.counts.removed),
                  timing: fmt(diff.counts.timing),
                })}
              </span>
            )}
            {!diff.tooLarge && (
              <Button size="sm" variant="secondary" onClick={jump}>
                {t('shell:lab.serialDiff.jump')}
              </Button>
            )}
          </>
        )}
      </div>
      {first?.reason === 'text' &&
        (A?.baudDiffers || B?.baudDiffers) &&
        (sel.a === 'verified' || sel.b === 'verified') && (
          <p className="rounded-md border border-danger/50 px-2 py-1">{t('shell:lab.serialDiff.baudHint')}</p>
        )}
      {diff?.tooLarge && <p className="text-ink-muted">{t('shell:lab.serialDiff.tooLarge')}</p>}
      {(A?.truncated || B?.truncated) && (
        <p className="text-ink-muted">{t('shell:lab.serialDiff.truncated')}</p>
      )}

      {diff && !diff.tooLarge && rows.length > 0 && (
        <div
          aria-label={t('shell:lab.serialDiff.table')}
          role="list"
          className="rounded-md border border-line"
        >
          {start > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setStart(Math.max(0, start - ROWS_SHOWN))}>
              {t('shell:lab.serialDiff.earlier')}
            </Button>
          )}
          {shown.map((r, k) => {
            const index = start + k;
            return (
              <div
                key={index}
                role="listitem"
                tabIndex={-1}
                ref={(el) => {
                  if (el && focusRow.current === index) {
                    focusRow.current = null;
                    el.focus();
                  }
                }}
                aria-current={index === firstRow ? 'true' : undefined}
                data-kind={r.kind}
                className={cn(
                  'grid grid-cols-[4.5rem_1fr] gap-x-2 border-b border-line/50 px-1 py-0.5 last:border-b-0 focus:outline focus:outline-2 focus:outline-brand-600 @[600px]:grid-cols-[4.5rem_1fr_1fr]',
                  r.kind !== 'equal' && 'bg-danger/5',
                  index === firstRow && 'bg-danger/10',
                )}
              >
                <span className="row-span-2 text-ink-muted @[600px]:row-span-1">
                  {r.kind !== 'equal' && (
                    <>
                      <span aria-hidden className="me-1 font-mono">
                        {MARK[r.kind]}
                      </span>
                      {kindLabel(r.kind)}
                    </>
                  )}
                </span>
                {SIDES.map((side) => cell(side === SIDES[0] ? A : B, r[side], side))}
              </div>
            );
          })}
          {start + ROWS_SHOWN < rows.length && (
            <Button size="sm" variant="ghost" onClick={() => setStart(start + ROWS_SHOWN)}>
              {t('shell:lab.serialDiff.later')}
            </Button>
          )}
        </div>
      )}
      <p className="text-ink-muted">
        {sourceLabel(sel.a)} ↔ {sourceLabel(sel.b)}
        {files.a && sel.a === 'file' ? ` · ${files.a.name}` : ''}
        {files.b && sel.b === 'file' ? ` · ${files.b.name}` : ''}
      </p>
    </div>
  );
}
