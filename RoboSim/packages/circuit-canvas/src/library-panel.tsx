import { CATALOG_MANIFESTS, type ComponentManifest } from '@robosim/catalog/manifests';
import { cn } from '@robosim/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PART_DRAG_TYPE } from './view.js';
import { addComponent } from './document.js';
import { interfacesOf, rankParts, WEAK_SCORE, type RankedPart } from './search.js';
import type { CircuitEditorState } from './use-circuit-editor.js';

type Category = 'all' | ComponentManifest['category'];
type CompareRow = 'voltage' | 'interface' | 'price' | 'functions';

/** Parts that can be ticked for the side-by-side comparison (TD §18.6). */
const COMPARE_MAX = 3;

/**
 * Component library (FR-CIR-10, FR-CIR-12): search in Persian and English at once, by name or by what a
 * part does, filter by category, then click to add at the centre of the view or drag onto the canvas.
 * Search results are ranked, say why a part matches and show voltage / interface / price chips; up to
 * three can be compared side by side. By default it lists every part shipping through P2 (catalogue
 * Tiers A–C). Pro parts carry a badge: they run anywhere, but saving them to the cloud needs
 * `components.tier = all` (PRD §3).
 */
export function LibraryPanel({
  editor,
  phase = 'P2',
  priceOf,
  formatPrice,
  onAskAi,
}: {
  editor: CircuitEditorState;
  phase?: 'P1' | 'P2' | 'P3' | 'P4';
  /** Catalogue unit price of a part type (IRR), null when unpriced; absent hides nothing but shows "—". */
  priceOf?: (type: string) => number | null;
  formatPrice?: (irr: number) => string;
  /** Opens the AI assistant with the query; absent when AI is not usable (signed out, no provider). */
  onAskAi?: (query: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category>('all');
  const [compare, setCompare] = useState<readonly string[]>([]);
  const order = ['P1', 'P2', 'P3', 'P4'];
  const available = CATALOG_MANIFESTS.filter((m) => order.indexOf(m.phase) <= order.indexOf(phase));
  const categories: Category[] = ['all', ...new Set(available.map((m) => m.category))];
  const nameIn = (lng: string, m: ComponentManifest) => i18n.getFixedT(lng)(`components:${m.nameKey}`);
  const results = rankParts(
    query,
    available.filter((m) => category === 'all' || m.category === category),
    (m) => [nameIn('fa', m), nameIn('en', m), m.id],
  );
  const searching = query.trim().length >= 2;
  const weak = searching && (results[0]?.score ?? 0) < WEAK_SCORE;

  const num = (v: number) => new Intl.NumberFormat(i18n.language === 'fa' ? 'fa-IR' : 'en-US').format(v);
  const name = (m: ComponentManifest) => t(`components:${m.nameKey}`);
  /** Voltage chip: the safety limit, else display-only rating / nominal / forward voltage (TD §18.6). */
  const voltage = (m: ComponentManifest): string | null => {
    const l = m.limits;
    const min = l['minVoltageV'];
    const max = l['maxVoltageV'] ?? l['ratedVoltageV'];
    if (min !== undefined && max !== undefined)
      return t('editor:library.chip.voltageRange', { min: num(min), max: num(max) });
    if (max !== undefined) return t('editor:library.chip.voltageMax', { max: num(max) });
    const nominal = l['nominalVoltageV'];
    if (nominal !== undefined) return t('editor:library.chip.voltageNominal', { v: num(nominal) });
    const vf = l['forwardVoltageV'];
    return vf !== undefined ? t('editor:library.chip.voltageForward', { v: num(vf) }) : null;
  };
  const interfaceText = (m: ComponentManifest): string | null => {
    const list = interfacesOf(m);
    return list.length ? list.map((i) => t(`editor:library.interface.${i}`)).join(' · ') : null;
  };
  const money = (m: ComponentManifest): string | null => {
    const irr = priceOf?.(m.id) ?? null;
    return irr === null ? null : (formatPrice?.(irr) ?? num(irr));
  };
  const why = (r: RankedPart): string | null => {
    const fn = r.via.functionId;
    if (r.via.kind !== 'function' || !fn) return null;
    const base = r.manifest.nameKey.replace(/\.name$/, '');
    return t('editor:library.why', {
      label: t(`components:functions.${fn}.label`),
      why: t([`components:${base}.why.${fn}`, `components:functions.${fn}.why`]),
    });
  };
  const toggleCompare = (id: string) =>
    setCompare((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length < COMPARE_MAX ? [...c, id] : c));
  const compared = compare.flatMap((id) => available.find((m) => m.id === id) ?? []);

  const listFormat = new Intl.ListFormat(i18n.language === 'fa' ? 'fa-IR' : 'en-US', { style: 'narrow' });
  const dash = t('editor:library.chip.none');
  const compareRows: readonly (readonly [CompareRow, (m: ComponentManifest) => string])[] = [
    ['voltage', (m) => voltage(m) ?? dash],
    ['interface', (m) => interfaceText(m) ?? dash],
    ['price', (m) => money(m) ?? dash],
    [
      'functions',
      (m) => listFormat.format((m.functions ?? []).map((f) => t(`components:functions.${f}.label`))),
    ],
  ];

  const add = (type: string) => {
    const at = editor.viewCenterRef.current;
    editor.apply((d) => addComponent(d, type, at).doc);
    editor.setSelection({ parts: [addComponent(editor.doc, type, at).id], wire: null });
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
      <ul
        aria-label={t('editor:library.title')}
        className="flex min-h-24 flex-1 flex-col gap-1 overflow-y-auto"
      >
        {results.map((r) => {
          const m = r.manifest;
          const reason = searching ? why(r) : null;
          const chips = searching
            ? [voltage(m), interfaceText(m), money(m) ?? t('editor:library.chip.noPrice')].filter(
                (c) => c !== null,
              )
            : [];
          const ticked = compare.includes(m.id);
          return (
            <li key={m.id} className="flex flex-col gap-0.5">
              <button
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(PART_DRAG_TYPE, m.id);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => add(m.id)}
                aria-label={
                  m.tier === 'pro'
                    ? t('editor:library.addPro', { name: name(m) })
                    : t('editor:library.add', { name: name(m) })
                }
                title={m.tier === 'pro' ? t('editor:library.proHint') : undefined}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md border border-line bg-surface px-2 py-1.5 text-start text-sm hover:bg-surface-raised',
                )}
              >
                <span className="me-auto">{name(m)}</span>
                {m.tier === 'pro' && (
                  <span className="rounded bg-surface-raised px-1 text-[10px] font-semibold text-ink-muted">
                    {t('editor:library.pro')}
                  </span>
                )}
              </button>
              {searching && (
                <div className="flex flex-col gap-0.5 px-1 text-xs text-ink-muted">
                  {reason && <p>{reason}</p>}
                  <div className="flex flex-wrap items-center gap-1">
                    {chips.map((c) => (
                      <span key={c} className="rounded bg-surface-raised px-1.5 py-0.5 tabular-nums">
                        {c}
                      </span>
                    ))}
                    <label className="ms-auto flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={ticked}
                        disabled={!ticked && compare.length >= COMPARE_MAX}
                        onChange={() => toggleCompare(m.id)}
                        aria-label={t('editor:library.compare.tick', { name: name(m) })}
                      />
                      {t('editor:library.compare.short')}
                    </label>
                  </div>
                </div>
              )}
            </li>
          );
        })}
        {results.length === 0 && <li className="text-sm text-ink-muted">{t('editor:library.empty')}</li>}
        {weak && onAskAi && (
          <li>
            <button
              type="button"
              onClick={() => onAskAi(query.trim())}
              className="text-start text-sm text-brand-600 underline-offset-2 hover:underline"
            >
              {t('editor:library.askAi', { query: query.trim() })}
            </button>
          </li>
        )}
      </ul>
      {compared.length > 0 && (
        <section
          aria-labelledby="library-compare-title"
          className="flex max-h-[45%] min-h-0 shrink-0 flex-col gap-1 overflow-y-auto border-t border-line pt-2"
        >
          <div className="flex items-center gap-2">
            <h3 id="library-compare-title" className="me-auto text-xs font-semibold text-ink-muted">
              {t('editor:library.compare.title', { count: compared.length, max: COMPARE_MAX })}
            </h3>
            <button
              type="button"
              onClick={() => setCompare([])}
              className="text-xs text-brand-600 hover:underline"
            >
              {t('editor:library.compare.clear')}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th scope="col" className="sr-only">
                    {t('editor:library.compare.property')}
                  </th>
                  {compared.map((m) => (
                    <th key={m.id} scope="col" className="px-1 py-0.5 text-start font-semibold">
                      {name(m)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {compareRows.map(([row, cell]) => (
                  <tr key={row} className="border-t border-line align-top">
                    <th scope="row" className="px-1 py-0.5 text-start font-medium text-ink-muted">
                      {t(`editor:library.compare.row.${row}`)}
                    </th>
                    {compared.map((m) => (
                      <td key={m.id} className="px-1 py-0.5 tabular-nums">
                        {cell(m)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </section>
  );
}
