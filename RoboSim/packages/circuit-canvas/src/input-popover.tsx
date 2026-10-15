import type { ComponentInstance } from '@robosim/shared';
import { useTranslation } from 'react-i18next';
import type { InputSpec } from './interaction.js';

/** Sliders and checkboxes for a part's inputs, next to the part on the canvas. */
export function InputPopover({
  part,
  inputs,
  value,
  onChange,
  onClose,
  left,
  top,
}: {
  part: ComponentInstance;
  inputs: readonly InputSpec[];
  value: (name: string, fallback: number | boolean) => number | boolean;
  onChange: (name: string, value: number | boolean) => void;
  onClose: () => void;
  left: number;
  top: number;
}) {
  const { t, i18n } = useTranslation();
  const fmt = (v: number) =>
    new Intl.NumberFormat(i18n.language === 'fa' ? 'fa-IR' : 'en-US', { maximumFractionDigits: 2 }).format(v);
  return (
    <div
      role="dialog"
      aria-label={t('editor:inputs.title', { part: part.id })}
      className="absolute z-10 flex w-56 flex-col gap-2 rounded-md border border-line bg-surface p-2 text-sm text-ink shadow-lg"
      style={{ left, top }}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono font-semibold">{part.id}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('editor:inputs.close')}
          className="rounded px-1 text-ink-muted hover:bg-surface-raised"
        >
          ×
        </button>
      </div>
      {inputs.map((spec) => {
        const label = t(`editor:input.${spec.name}`);
        if (spec.type === 'boolean')
          return (
            <label key={spec.name} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={Boolean(value(spec.name, spec.default))}
                onChange={(e) => onChange(spec.name, e.target.checked)}
              />
              {label}
            </label>
          );
        const min = spec.min ?? 0;
        const max = spec.max ?? 1;
        const v = Number(value(spec.name, spec.default));
        return (
          <label key={spec.name} className="flex flex-col gap-0.5">
            <span className="flex justify-between gap-2 text-xs text-ink-muted">
              {label}
              <span className="tabular-nums text-ink">{fmt(v)}</span>
            </span>
            <input
              type="range"
              min={min}
              max={max}
              step={(max - min) / 100}
              value={v}
              onChange={(e) => onChange(spec.name, Number(e.target.value))}
            />
          </label>
        );
      })}
    </div>
  );
}
