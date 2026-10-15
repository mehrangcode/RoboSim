import { Button } from '@robosim/ui';
import { useTranslation } from 'react-i18next';
import { CircuitCanvas } from './circuit-canvas.js';
import { LibraryPanel } from './library-panel.js';
import { PropertyPanel } from './property-panel.js';
import type { CircuitEditorState } from './use-circuit-editor.js';

/** Library | canvas | properties, with undo/redo (FR-CIR-01..06, 10). */
export function CircuitEditor({
  editor,
  live,
}: {
  editor: CircuitEditorState;
  live?: Readonly<Record<string, unknown>> | undefined;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-3 lg:grid-cols-[12rem_1fr_15rem]">
      <div className="max-h-[32rem] min-h-0 overflow-hidden lg:flex lg:flex-col">
        <LibraryPanel editor={editor} />
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <div role="toolbar" aria-label={t('editor:toolbar')} className="flex gap-1.5">
          <Button size="sm" variant="secondary" onClick={editor.undo} disabled={!editor.canUndo}>
            {t('editor:actions.undo')}
          </Button>
          <Button size="sm" variant="secondary" onClick={editor.redo} disabled={!editor.canRedo}>
            {t('editor:actions.redo')}
          </Button>
        </div>
        <CircuitCanvas editor={editor} live={live} className="h-[30rem]" />
      </div>
      <div className="max-h-[32rem] overflow-y-auto">
        <PropertyPanel editor={editor} />
      </div>
    </div>
  );
}
