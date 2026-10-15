import { Button } from '@robosim/ui';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

const SHORTCUTS = [
  ['F5', 'run'],
  ['Shift+F5', 'stop'],
  ['F10', 'step'],
  ['F6', 'reset'],
  ['Ctrl+S', 'save'],
  ['Ctrl+Z', 'undo'],
  ['Ctrl+Y', 'redo'],
  ['R', 'rotate'],
  ['F', 'flip'],
  ['Delete', 'delete'],
  ['Esc', 'cancel'],
  ['F1', 'help'],
] as const;

/** Keyboard shortcuts of the workspace (FR-WRK-02). */
export function HelpDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => close.current?.focus(), []);
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        className="w-[min(28rem,90vw)] rounded-lg border border-line bg-surface p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <h2 id="help-title" className="mb-3 text-lg font-semibold">
          {t('shell:editor.shortcuts.title')}
        </h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {SHORTCUTS.map(([keys, action]) => (
            <div key={action} className="contents">
              <dt>
                <kbd
                  dir="ltr"
                  className="rounded border border-line bg-surface-raised px-1.5 font-mono text-xs"
                >
                  {keys}
                </kbd>
              </dt>
              <dd>{t(`shell:editor.shortcuts.${action}`)}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 flex justify-end">
          <Button ref={close} size="sm" onClick={onClose}>
            {t('shell:editor.shortcuts.close')}
          </Button>
        </div>
      </div>
    </div>
  );
}
