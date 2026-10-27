import { CATALOG_MANIFESTS } from '@robosim/catalog/manifests';
import { addComponent, matches, type CircuitEditorState } from '@robosim/circuit-canvas';
import { cn } from '@robosim/ui';
import type { TFunction, i18n as I18n } from 'i18next';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

export interface PaletteCommand {
  readonly id: string;
  readonly group: 'actions' | 'parts';
  readonly label: string;
  /** Further words it is found by (the other UI language's name, an id). */
  readonly keywords?: readonly string[];
  readonly shortcut?: string;
  readonly disabled?: boolean;
  readonly run: () => void;
}

/** Results listed at once; typing narrows the rest. */
const LIMIT = 60;

/**
 * Command palette (FR-WRK-05): every workspace action and every part, searched in Persian and
 * English at once. Arrow keys move, Enter runs, Escape closes.
 */
export function CommandPalette({
  actions,
  editor,
  onClose,
}: {
  actions: readonly PaletteCommand[];
  /** The circuit parts are offered for (while it can be edited). */
  editor?: CircuitEditorState | undefined;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const commands = useMemo(
    () => [...actions, ...(editor ? partCommands(editor, t, i18n) : [])],
    [actions, editor, t, i18n],
  );
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  useEffect(() => input.current?.focus(), []);

  const found = commands.filter((c) => !c.disabled && matches(query, [c.label, ...(c.keywords ?? [])]));
  // With no query, actions first; parts are there to be searched for.
  const shown = (query.trim() ? found : found.filter((c) => c.group === 'actions')).slice(0, LIMIT);
  const current = Math.min(active, Math.max(0, shown.length - 1));

  useEffect(() => {
    list.current?.querySelector(`[data-index="${current}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [current]);

  const run = (c: PaletteCommand | undefined) => {
    if (!c) return;
    onClose();
    c.run();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') setActive((current + 1) % Math.max(1, shown.length));
    else if (e.key === 'ArrowUp') setActive((current - 1 + shown.length) % Math.max(1, shown.length));
    else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(shown.length - 1);
    else if (e.key === 'Enter') run(shown[current]);
    else if (e.key === 'Escape') onClose();
    else return;
    e.preventDefault();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-30 flex items-start justify-center bg-black/40 pt-[12vh]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('shell:palette.title')}
        className="flex max-h-[70vh] w-[min(36rem,92vw)] flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={input}
          role="combobox"
          aria-expanded="true"
          aria-controls={`${id}-list`}
          aria-activedescendant={shown[current] ? `${id}-${current}` : undefined}
          aria-autocomplete="list"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder={t('shell:palette.placeholder')}
          aria-label={t('shell:palette.placeholder')}
          className="border-b border-line bg-transparent px-3 py-2.5 text-sm outline-none"
        />
        <ul
          ref={list}
          id={`${id}-list`}
          role="listbox"
          aria-label={t('shell:palette.title')}
          className="overflow-y-auto py-1"
        >
          {shown.map((c, i) => (
            <li
              key={c.id}
              id={`${id}-${i}`}
              data-index={i}
              role="option"
              aria-selected={i === current}
              onMouseMove={() => i !== current && setActive(i)}
              onClick={() => run(c)}
              className={cn(
                'flex cursor-pointer items-center gap-3 px-3 py-1.5 text-sm',
                i === current && 'bg-surface-raised',
              )}
            >
              <span className="w-12 shrink-0 text-xs text-ink-muted">
                {c.group === 'parts' ? t('shell:palette.groups.parts') : t('shell:palette.groups.actions')}
              </span>
              <span className="min-w-0 flex-1 truncate">{c.label}</span>
              {c.shortcut && (
                <kbd
                  dir="ltr"
                  className="rounded border border-line bg-surface-raised px-1.5 font-mono text-xs"
                >
                  {c.shortcut}
                </kbd>
              )}
            </li>
          ))}
          {shown.length === 0 && (
            <li className="px-3 py-3 text-sm text-ink-muted">{t('shell:palette.none')}</li>
          )}
        </ul>
      </div>
    </div>,
    document.body,
  );
}

/** "Add part" commands for every catalogue part through `phase`, named in both UI languages. */
function partCommands(
  editor: CircuitEditorState,
  t: TFunction,
  i18n: I18n,
  phase: 'P1' | 'P2' | 'P3' | 'P4' = 'P2',
): PaletteCommand[] {
  const order = ['P1', 'P2', 'P3', 'P4'];
  return CATALOG_MANIFESTS.filter((m) => order.indexOf(m.phase) <= order.indexOf(phase)).map((m) => {
    const name = (lng: string) => i18n.getFixedT(lng)(`components:${m.nameKey}`);
    return {
      id: `part:${m.id}`,
      group: 'parts',
      label: t('shell:palette.addPart', { name: t(`components:${m.nameKey}`) }),
      keywords: [name('fa'), name('en'), m.id],
      run: () => {
        const at = editor.viewCenterRef.current;
        editor.apply((d) => addComponent(d, m.id, at).doc);
        editor.setSelection({ parts: [addComponent(editor.doc, m.id, at).id], wire: null });
      },
    };
  });
}
