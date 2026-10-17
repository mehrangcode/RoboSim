import { BUILD_FILE_NAME, BUILD_LIMITS, type BuildDiagnostic } from '@robosim/shared';
import { Button, cn } from '@robosim/ui';
import { Suspense, lazy, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { loadMonacoEditor } from './monaco-loader.js';
import { PlainEditor } from './plain-editor.js';
import type { RevealRequest, SketchFile } from './types.js';

/** Extensions a learner can add next to the `.ino` (one sketch file, as in the Arduino IDE). */
const NEW_FILE = /\.(h|hpp|c|cpp)$/;
const TEMPLATE: Record<string, string> = {
  h: '#pragma once\n\n',
  hpp: '#pragma once\n\n',
  c: '',
  cpp: '#include <Arduino.h>\n\n',
};

const isMain = (name: string) => name.endsWith('.ino');

/** Main sketch first, the rest by name (Arduino IDE tab order). */
const ordered = (files: readonly SketchFile[]) =>
  [...files].sort((a, b) => Number(isMain(b.name)) - Number(isMain(a.name)) || a.name.localeCompare(b.name));

type NameError = 'invalid' | 'duplicate' | 'tooMany';

function checkName(name: string, files: readonly SketchFile[], renaming?: string): NameError | null {
  if (!renaming && files.length >= BUILD_LIMITS.maxFiles) return 'tooMany';
  const key = name.toLowerCase();
  if (files.some((f) => f.name !== renaming && f.name.toLowerCase() === key)) return 'duplicate';
  if (!BUILD_FILE_NAME.test(name) || !NEW_FILE.test(name)) return 'invalid';
  return null;
}

/** Error mark on a file tab (icon next to the count, never colour alone). */
const ERROR_MARK = '●';

// Monaco's chunk loads on first use; offline or blocked, the plain editor simply stays.
const LazyMonaco = lazy(() =>
  loadMonacoEditor().then(
    (Editor) => ({ default: Editor }),
    () => ({ default: PlainEditor }),
  ),
);

/**
 * Sketch code editor (FR-COD-01): a tab per file, Monaco (lazy) with a plain fallback, always LTR.
 * With `onFilesChange` the learner can add, rename and delete `.h`/`.cpp` files; the `.ino` stays.
 */
export function CodeEditor({
  files,
  active,
  onActiveChange,
  onChange,
  onFilesChange,
  diagnostics,
  reveal,
  label,
  className,
}: {
  files: readonly SketchFile[];
  active: string;
  onActiveChange: (name: string) => void;
  onChange: (name: string, content: string) => void;
  onFilesChange?: ((files: readonly SketchFile[]) => void) | undefined;
  diagnostics: readonly BuildDiagnostic[];
  reveal: RevealRequest | null;
  label: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<{ kind: 'new' | 'rename'; name: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const tabs = ordered(files);
  const error = form?.name ? checkName(form.name, files, form.kind === 'rename' ? active : undefined) : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!form || !onFilesChange || !form.name || error) return;
    const name = form.name;
    if (form.kind === 'new') {
      onFilesChange([...files, { name, content: TEMPLATE[name.split('.').pop() ?? ''] ?? '' }]);
    } else if (name !== active) {
      onFilesChange(files.map((f) => (f.name === active ? { ...f, name } : f)));
    }
    onActiveChange(name);
    setForm(null);
  };

  const remove = () => {
    if (!onFilesChange) return;
    onFilesChange(files.filter((f) => f.name !== active));
    onActiveChange(tabs.find((f) => isMain(f.name))?.name ?? tabs[0]?.name ?? '');
    setConfirmDelete(false);
  };

  const editorProps = { files, active, onChange, diagnostics, reveal, label };
  const count = (name: string) => diagnostics.filter((d) => d.file === name && d.severity === 'error').length;

  return (
    // Code is always LTR, also in the Persian UI.
    <div
      dir="ltr"
      className={cn('flex min-h-0 flex-col overflow-hidden rounded-md border border-line', className)}
    >
      <div className="flex flex-wrap items-center gap-1 border-b border-line bg-surface-raised px-1 py-1 text-xs">
        <div role="tablist" aria-label={t('shell:code.files')} className="flex flex-wrap gap-1">
          {tabs.map((f) => {
            const errors = count(f.name);
            return (
              <button
                key={f.name}
                type="button"
                role="tab"
                aria-selected={f.name === active}
                onClick={() => {
                  onActiveChange(f.name);
                  setForm(null);
                  setConfirmDelete(false);
                }}
                className={cn(
                  'rounded px-2 py-1 font-mono',
                  f.name === active ? 'bg-surface font-semibold text-ink' : 'text-ink-muted hover:bg-surface',
                )}
              >
                {f.name}
                {errors > 0 && (
                  <span className="ms-1 text-danger" aria-label={t('shell:code.errors', { count: errors })}>
                    {ERROR_MARK} {errors}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {onFilesChange && !form && !confirmDelete && (
          <div dir="auto" className="ms-auto flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2"
              onClick={() => setForm({ kind: 'new', name: '' })}
            >
              {t('shell:code.newFile')}
            </Button>
            {!isMain(active) && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2"
                  onClick={() => setForm({ kind: 'rename', name: active })}
                >
                  {t('shell:code.rename')}
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setConfirmDelete(true)}>
                  {t('shell:code.delete')}
                </Button>
              </>
            )}
          </div>
        )}
      </div>
      {form && (
        <form
          dir="auto"
          onSubmit={submit}
          className="flex flex-wrap items-center gap-2 border-b border-line px-2 py-1.5 text-xs"
        >
          <input
            dir="ltr"
            autoFocus
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value.trim() })}
            onKeyDown={(e) => e.key === 'Escape' && setForm(null)}
            aria-label={form.kind === 'new' ? t('shell:code.newFileName') : t('shell:code.renameTo')}
            aria-invalid={error !== null}
            placeholder={t('shell:code.fileNamePlaceholder')}
            className="w-40 rounded-md border border-line bg-transparent px-2 py-1 font-mono"
          />
          <Button size="sm" type="submit" className="h-7 px-2" disabled={!form.name || error !== null}>
            {form.kind === 'new' ? t('shell:code.create') : t('shell:code.rename')}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setForm(null)}>
            {t('shell:code.cancel')}
          </Button>
          {error && (
            <span role="alert" className="text-danger">
              {t(`shell:code.nameError.${error}`, { max: BUILD_LIMITS.maxFiles })}
            </span>
          )}
        </form>
      )}
      {confirmDelete && (
        <div
          dir="auto"
          role="alertdialog"
          aria-label={t('shell:code.delete')}
          className="flex flex-wrap items-center gap-2 border-b border-line px-2 py-1.5 text-xs"
        >
          <span>{t('shell:code.confirmDelete', { name: active })}</span>
          <Button size="sm" className="h-7 px-2" onClick={remove}>
            {t('shell:code.delete')}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setConfirmDelete(false)}>
            {t('shell:code.keep')}
          </Button>
        </div>
      )}
      <div className="min-h-0 flex-1">
        <Suspense fallback={<PlainEditor {...editorProps} />}>
          <LazyMonaco {...editorProps} />
        </Suspense>
      </div>
    </div>
  );
}
