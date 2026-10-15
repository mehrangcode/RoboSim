import { findManifest, type PropSpec } from '@robosim/catalog/manifests';
import { BOARD_PART, type PinRef } from '@robosim/shared';
import { Button, cn } from '@robosim/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WIRE_COLORS } from './view.js';
import {
  deleteComponents,
  deleteWires,
  duplicateComponents,
  flipComponents,
  rotateComponents,
  setProp,
  setWireColor,
} from './document.js';
import { E12_OHMS } from './search.js';
import type { CircuitEditorState } from './use-circuit-editor.js';

const pinLabel = (r: PinRef) => (r.part === BOARD_PART ? `Uno ${r.pin}` : `${r.part}.${r.pin}`);

/** A number property: accepted only inside the manifest's range, otherwise explained (FR-CIR-05). */
function NumberField({
  label,
  spec,
  value,
  onCommit,
}: {
  label: string;
  spec: Extract<PropSpec, { type: 'number' }>;
  value: number;
  onCommit: (v: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState<string | null>(null);
  const fmt = (v: number) => new Intl.NumberFormat(i18n.language === 'fa' ? 'fa-IR' : 'en-US').format(v);
  const commit = () => {
    const v = Number(draft.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/,/g, ''));
    if (draft.trim() === '' || !Number.isFinite(v)) return setError(t('editor:props.notNumber'));
    if ((spec.min !== undefined && v < spec.min) || (spec.max !== undefined && v > spec.max))
      return setError(
        t('editor:props.outOfRange', {
          min: fmt(spec.min ?? -Infinity),
          max: fmt(spec.max ?? Infinity),
          unit: spec.unit ?? '',
        }),
      );
    setError(null);
    if (v !== value) onCommit(v);
  };
  const id = `prop-${label}`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs text-ink-muted">
        {label}
        {spec.unit && <span dir="ltr"> ({spec.unit})</span>}
      </label>
      <input
        id={id}
        dir="ltr"
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        aria-invalid={error !== null}
        aria-describedby={error ? `${id}-error` : undefined}
        className={cn(
          'rounded-md border bg-surface px-2 py-1 text-sm',
          error ? 'border-danger' : 'border-line',
        )}
      />
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** Properties of the selected part or wire; with nothing selected, the accessible list of parts. */
export function PropertyPanel({ editor }: { editor: CircuitEditorState }) {
  const { t } = useTranslation();
  const { doc, selection, apply, setSelection } = editor;
  const wire = selection.wire ? doc.wires.find((w) => w.id === selection.wire) : undefined;
  const parts = doc.components.filter((c) => selection.parts.includes(c.id));
  const part = parts.length === 1 ? parts[0] : undefined;
  const manifest = part ? findManifest(part.type) : undefined;
  const ids = parts.map((p) => p.id);

  if (wire)
    return (
      <section aria-labelledby="props-title" className="flex flex-col gap-3">
        <h2 id="props-title" className="text-sm font-semibold">
          {t('editor:wire.title', { id: wire.id })}
        </h2>
        <p dir="ltr" className="text-start font-mono text-xs text-ink-muted">
          {pinLabel(wire.from)} → {pinLabel(wire.to)}
        </p>
        <fieldset>
          <legend className="mb-1 text-xs text-ink-muted">{t('editor:wire.color')}</legend>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(WIRE_COLORS).map(([name, css]) => (
              <button
                key={name}
                type="button"
                aria-pressed={wire.color === name}
                aria-label={t(`editor:color.${name}`)}
                title={t(`editor:color.${name}`)}
                onClick={() => apply((d) => setWireColor(d, wire.id, name))}
                className={cn(
                  'size-6 rounded-full border border-line',
                  wire.color === name && 'ring-2 ring-accent ring-offset-1',
                )}
                style={{ background: css }}
              />
            ))}
          </div>
        </fieldset>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            apply((d) => deleteWires(d, [wire.id]));
            setSelection({ parts: [], wire: null });
          }}
        >
          {t('editor:actions.delete')}
        </Button>
      </section>
    );

  if (parts.length > 0)
    return (
      <section aria-labelledby="props-title" className="flex flex-col gap-3">
        <h2 id="props-title" className="text-sm font-semibold">
          {part && manifest ? (
            <>
              {t(`components:${manifest.nameKey}`)}{' '}
              <span dir="ltr" className="font-mono text-ink-muted">
                {part.id}
              </span>
            </>
          ) : (
            t('editor:props.multiple', { count: parts.length })
          )}
        </h2>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => apply((d) => rotateComponents(d, ids))}>
            {t('editor:actions.rotate')}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => apply((d) => flipComponents(d, ids))}>
            {t('editor:actions.flip')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              let copies: string[] = [];
              apply((d) => {
                const dup = duplicateComponents(d, ids);
                copies = dup.ids;
                return dup.doc;
              });
              setSelection({ parts: copies, wire: null });
            }}
          >
            {t('editor:actions.duplicate')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              apply((d) => deleteComponents(d, ids));
              setSelection({ parts: [], wire: null });
            }}
          >
            {t('editor:actions.delete')}
          </Button>
        </div>
        {part?.seats && (
          <p className="text-xs text-ink-muted">
            {t('editor:props.seated', {
              part: [...new Set(Object.values(part.seats).map((s) => s.part))].join(', '),
            })}
          </p>
        )}
        {part && manifest && (
          <div className="flex flex-col gap-2">
            {Object.entries(manifest.props).map(([key, spec]) => {
              const label = t(`editor:prop.${key}`);
              const raw = part.props[key] ?? spec.default;
              const set = (v: number | boolean | string) => apply((d) => setProp(d, part.id, key, v));
              if (spec.type === 'boolean')
                return (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={Boolean(raw)} onChange={(e) => set(e.target.checked)} />
                    {label}
                  </label>
                );
              if (spec.type === 'enum')
                return (
                  <label key={key} className="flex flex-col gap-1 text-xs text-ink-muted">
                    {label}
                    <select
                      value={String(raw)}
                      onChange={(e) => set(e.target.value)}
                      className="rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink"
                    >
                      {spec.options.map((o) => (
                        <option key={o} value={o}>
                          {t(`editor:option.${o}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              return (
                <div key={key} className="flex flex-col gap-1">
                  <NumberField
                    key={`${part.id}.${key}.${String(raw)}`}
                    label={label}
                    spec={spec}
                    value={Number(raw)}
                    onCommit={set}
                  />
                  {part.type === 'passive.resistor' && key === 'ohms' && (
                    <label className="flex flex-col gap-1 text-xs text-ink-muted">
                      {t('editor:props.e12')}
                      <select
                        dir="ltr"
                        value={E12_OHMS.includes(Number(raw)) ? String(raw) : ''}
                        onChange={(e) => e.target.value && set(Number(e.target.value))}
                        className="rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink"
                      >
                        <option value="">—</option>
                        {E12_OHMS.map((v) => (
                          <option key={v} value={v}>
                            {v >= 1e6 ? `${v / 1e6} MΩ` : v >= 1e3 ? `${v / 1e3} kΩ` : `${v} Ω`}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    );

  return (
    <section aria-labelledby="parts-title" className="flex flex-col gap-2">
      <h2 id="parts-title" className="text-sm font-semibold">
        {t('editor:parts.title', { count: doc.components.length })}
      </h2>
      <p className="text-xs text-ink-muted">{t('editor:props.none')}</p>
      <ul className="flex flex-col gap-1">
        {doc.components.map((c) => {
          const m = findManifest(c.type);
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setSelection({ parts: [c.id], wire: null })}
                className="flex w-full justify-between gap-2 rounded-md px-2 py-1 text-start text-sm hover:bg-surface-raised"
              >
                <span>{m ? t(`components:${m.nameKey}`) : c.type}</span>
                <span dir="ltr" className="font-mono text-xs text-ink-muted">
                  {c.id}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
