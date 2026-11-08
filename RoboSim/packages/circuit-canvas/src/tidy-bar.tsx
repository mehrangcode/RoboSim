import { Button } from '@robosim/ui';
import { useTranslation } from 'react-i18next';
import type { TidyChoices, TidyState } from './use-tidy.js';

const CHOICES: readonly (keyof TidyChoices)[] = ['recolour', 'reroute', 'recolourSignals'];

/** The tidy preview's controls (FR-CIR-11): what to tidy, how many wires change, Apply / Cancel. */
export function TidyBar({ tidy, total }: { tidy: TidyState; total: number }) {
  const { t } = useTranslation();
  const count = tidy.changed.length;
  return (
    <div
      role="region"
      aria-label={t('editor:tidy.title')}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          tidy.cancel();
        }
      }}
      className="flex max-w-[calc(100%-1rem)] flex-wrap items-center gap-x-3 gap-y-1 rounded border border-line bg-surface px-2 py-1.5 text-xs shadow-sm"
    >
      <span className="font-semibold">{t('editor:tidy.title')}</span>
      <span className="text-ink-muted">
        {tidy.scope
          ? t('editor:tidy.scopeSelection', { count: tidy.scope.length })
          : t('editor:tidy.scopeAll', { count: total })}
      </span>
      {CHOICES.map((key) => (
        <label key={key} className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={tidy.choices[key]}
            disabled={key === 'recolourSignals' && !tidy.choices.recolour}
            onChange={(e) => tidy.setChoices({ ...tidy.choices, [key]: e.target.checked })}
          />
          {t(`editor:tidy.${key}`)}
        </label>
      ))}
      <span role="status" className="text-ink-muted">
        {tidy.failed
          ? t('editor:tidy.failed')
          : count
            ? t('editor:tidy.changes', { count })
            : t('editor:tidy.nothing')}
      </span>
      <span className="flex gap-1.5">
        <Button size="sm" onClick={tidy.apply} disabled={tidy.failed || count === 0} autoFocus>
          {t('editor:tidy.apply')}
        </Button>
        <Button size="sm" variant="secondary" onClick={tidy.cancel}>
          {t('editor:tidy.cancel')}
        </Button>
      </span>
    </div>
  );
}
