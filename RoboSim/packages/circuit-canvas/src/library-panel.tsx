import { CATALOG_MANIFESTS, type ComponentManifest } from '@robosim/catalog/manifests';
import { cn } from '@robosim/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PART_DRAG_TYPE } from './view.js';
import { addComponent } from './document.js';
import { matches } from './search.js';
import type { CircuitEditorState } from './use-circuit-editor.js';

type Category = 'all' | ComponentManifest['category'];

/**
 * Component library (FR-CIR-10): search in Persian and English at once, filter by category, then
 * click to add at the centre of the view or drag onto the canvas. By default it lists every part
 * shipping through P2 (catalogue Tiers A–C).
 */
export function LibraryPanel({
  editor,
  phase = 'P2',
}: {
  editor: CircuitEditorState;
  phase?: 'P1' | 'P2' | 'P3' | 'P4';
}) {
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category>('all');
  const order = ['P1', 'P2', 'P3', 'P4'];
  const available = CATALOG_MANIFESTS.filter((m) => order.indexOf(m.phase) <= order.indexOf(phase));
  const categories: Category[] = ['all', ...new Set(available.map((m) => m.category))];
  const nameIn = (lng: string, m: ComponentManifest) => i18n.getFixedT(lng)(`components:${m.nameKey}`);
  const shown = available.filter(
    (m) =>
      (category === 'all' || m.category === category) &&
      matches(query, [nameIn('fa', m), nameIn('en', m), m.id]),
  );

  const add = (type: string) => {
    let id = '';
    editor.apply((d) => {
      const added = addComponent(d, type, editor.viewCenterRef.current);
      id = added.id;
      return added.doc;
    });
    editor.setSelection({ parts: [id], wire: null });
  };

  return (
    <section aria-labelledby="library-title" className="flex min-h-0 flex-col gap-2">
      <h2 id="library-title" className="text-sm font-semibold text-ink-muted">
        {t('editor:library.title')}
      </h2>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('editor:library.search')}
        aria-label={t('editor:library.search')}
        className="rounded-md border border-line bg-surface px-2 py-1 text-sm"
      />
      <label className="flex items-center gap-2 text-xs text-ink-muted">
        {t('editor:library.category.label')}
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as Category)}
          className="min-w-0 flex-1 rounded-md border border-line bg-surface px-1 py-0.5 text-sm text-ink"
        >
          {categories.map((c) => (
            <option key={c} value={c}>
              {t(`editor:library.category.${c}`)}
            </option>
          ))}
        </select>
      </label>
      <ul aria-label={t('editor:library.title')} className="flex min-h-0 flex-col gap-1 overflow-y-auto">
        {shown.map((m) => (
          <li key={m.id}>
            <button
              type="button"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(PART_DRAG_TYPE, m.id);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onClick={() => add(m.id)}
              aria-label={t('editor:library.add', { name: t(`components:${m.nameKey}`) })}
              className={cn(
                'w-full rounded-md border border-line bg-surface px-2 py-1.5 text-start text-sm hover:bg-surface-raised',
              )}
            >
              {t(`components:${m.nameKey}`)}
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className="text-sm text-ink-muted">{t('editor:library.empty')}</li>}
      </ul>
    </section>
  );
}
