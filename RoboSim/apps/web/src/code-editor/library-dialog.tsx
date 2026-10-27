import { addApiDocs } from '@robosim/i18n/apidocs';
import { ARDUINO_LIBRARIES, type ArduinoLibrary } from '@robosim/shared';
import { Button } from '@robosim/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

const included = (source: string, lib: ArduinoLibrary) =>
  lib.includes.every((h) =>
    new RegExp(`^\\s*#\\s*include\\s*[<"]${h.replace('.', '\\.')}[>"]`, 'm').test(source),
  );

/**
 * Library manager (FR-COD-07): the core's and the pinned libraries with their versions; "Add"
 * inserts the `#include`s into the open file. Loaded on first open (descriptions ship with it).
 */
export default function LibraryDialog({
  source,
  onAdd,
  onClose,
}: {
  /** Content of the file the includes go into. */
  source: string;
  onAdd: (lib: ArduinoLibrary) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  // Descriptions live in the `apidocs` namespace, registered before the first render.
  useState(() => addApiDocs(i18n));
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const titleId = useId();
  useEffect(() => search.current?.focus(), []);

  const q = query.trim().toLowerCase();
  const shown = ARDUINO_LIBRARIES.filter(
    (l) =>
      !q ||
      l.name.toLowerCase().includes(q) ||
      t(`apidocs:library.${l.name}`).toLowerCase().includes(q) ||
      l.includes.some((h) => h.toLowerCase().includes(q)),
  );

  return createPortal(
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[80vh] w-[min(40rem,92vw)] flex-col rounded-lg border border-line bg-surface p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <h2 id={titleId} className="mb-1 text-lg font-semibold">
          {t('shell:code.libraries.title')}
        </h2>
        <p className="mb-3 text-sm text-ink-muted">{t('shell:code.libraries.hint')}</p>
        <input
          ref={search}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t('shell:code.libraries.search')}
          placeholder={t('shell:code.libraries.search')}
          className="mb-3 rounded-md border border-line bg-transparent px-2 py-1.5 text-sm"
        />
        <ul
          className="min-h-0 flex-1 divide-y divide-line overflow-y-auto"
          aria-label={t('shell:code.libraries.title')}
        >
          {shown.map((lib) => {
            const added = included(source, lib);
            return (
              <li key={lib.name} className="flex items-start gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span dir="ltr" className="font-mono font-semibold">
                      {lib.name}
                    </span>
                    <span dir="ltr" className="font-mono text-xs text-ink-muted">
                      {lib.version}
                    </span>
                    <span className="rounded bg-surface-raised px-1.5 text-xs text-ink-muted">
                      {lib.builtin ? t('shell:code.libraries.builtin') : t('shell:code.libraries.pinned')}
                    </span>
                  </div>
                  <p className="text-sm">{t(`apidocs:library.${lib.name}`)}</p>
                  <p dir="ltr" className="text-start font-mono text-xs text-ink-muted">
                    {lib.includes.map((h) => `#include <${h}>`).join('  ')}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={added ? 'ghost' : 'secondary'}
                  disabled={added}
                  onClick={() => {
                    onAdd(lib);
                    // The button turns into a disabled "Added": keep focus (and Escape) inside the dialog.
                    search.current?.focus();
                  }}
                  aria-label={t('shell:code.libraries.addNamed', { name: lib.name })}
                >
                  {added ? t('shell:code.libraries.added') : t('shell:code.libraries.add')}
                </Button>
              </li>
            );
          })}
          {shown.length === 0 && (
            <li className="py-4 text-sm text-ink-muted">{t('shell:code.libraries.none')}</li>
          )}
        </ul>
        <div className="mt-3 flex justify-end">
          <Button size="sm" onClick={onClose}>
            {t('shell:code.libraries.close')}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
