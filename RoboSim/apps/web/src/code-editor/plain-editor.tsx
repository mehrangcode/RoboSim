import type { BuildDiagnostic } from '@robosim/shared';
import { cn } from '@robosim/ui';
import { useEffect, useRef, type UIEvent } from 'react';
import type { EditorImplProps } from './types.js';

/** Gutter markers next to line numbers (icon, never colour alone). */
const LINE_MARK = { error: '●', warning: '○', note: '' } as const;

/**
 * Textarea editor with line numbers and diagnostic marks: shown while Monaco loads, and the editor
 * itself where Monaco cannot run (tests).
 */
export function PlainEditor({ files, active, onChange, diagnostics, reveal, label }: EditorImplProps) {
  const editor = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const code = files.find((f) => f.name === active)?.content ?? '';
  const marks = new Map<number, BuildDiagnostic['severity']>();
  for (const d of diagnostics)
    if (d.file === active && d.line > 0 && marks.get(d.line) !== 'error') marks.set(d.line, d.severity);
  const lines = code.split('\n').length;

  // Puts the caret on the diagnostic's line so the learner lands on it.
  useEffect(() => {
    const el = editor.current;
    if (!el || !reveal || reveal.file !== active || reveal.line < 1) return;
    const all = el.value.split('\n');
    const start = all.slice(0, reveal.line - 1).reduce((n, l) => n + l.length + 1, 0);
    el.focus();
    el.setSelectionRange(start, start + (all[reveal.line - 1]?.length ?? 0));
  }, [reveal, active]);

  const syncScroll = (e: UIEvent<HTMLTextAreaElement>) => {
    if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;
  };

  return (
    <div className="flex h-full min-h-0 overflow-hidden font-mono text-xs leading-5 [font-variant-ligatures:none]">
      <div
        ref={gutter}
        aria-hidden
        className="select-none overflow-hidden border-e border-line bg-surface-raised px-2 py-2 text-end text-ink-muted"
      >
        {Array.from({ length: lines }, (_, k) => {
          const mark = marks.get(k + 1);
          return (
            <div
              key={k}
              className={cn(
                mark === 'error' && 'font-bold text-danger',
                mark === 'warning' && 'font-bold text-ink',
              )}
            >
              {mark ? LINE_MARK[mark] : ''} {k + 1}
            </div>
          );
        })}
      </div>
      <textarea
        ref={editor}
        value={code}
        onChange={(e) => onChange(active, e.target.value)}
        onScroll={syncScroll}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        wrap="off"
        aria-label={label}
        className="min-w-0 flex-1 resize-none bg-transparent p-2 leading-5 outline-none"
      />
    </div>
  );
}
