import { BUILD_BOARDS, type EntitlementKey, type EntitlementValues } from '@robosim/shared';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormat } from '../lib/format.js';
import { inputClass } from '../ui/form.js';
import { ENTITLEMENT_GROUPS, entitlementKind, settingOptions } from './entitlement-kinds.js';

/** An entitlement set grouped Features / Quotas / Settings; `marked` keys get a badge (e.g. raised by an override). */
export function EntitlementList({
  values,
  marked,
  markLabel,
}: {
  values: EntitlementValues;
  marked?: ReadonlySet<string>;
  markLabel?: string;
}) {
  const { t } = useTranslation();
  const fmt = useFormat();
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {ENTITLEMENT_GROUPS.map((group) => (
        <section key={group.id} aria-labelledby={`ent-group-${group.id}`} className="min-w-0">
          <h4 id={`ent-group-${group.id}`} className="mb-2 text-sm font-semibold text-ink-muted">
            {t(`admin:group.${group.id}`)}
          </h4>
          <dl className="divide-y divide-line rounded-md border border-line text-sm">
            {group.keys.map((key) => (
              <div key={key} className="flex flex-wrap items-baseline justify-between gap-x-3 px-3 py-1.5">
                <dt className="text-ink-muted">{t(`admin:ent.${key}`)}</dt>
                <dd className="text-end font-medium">
                  {fmt.value(key, values[key])}
                  {marked?.has(key) && markLabel && (
                    <span className="ms-2 rounded bg-brand-50 px-1.5 py-0.5 text-xs font-normal text-brand-700">
                      {markLabel}
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

/** The input for one entitlement value, matching its kind (checkbox, number + unlimited, select, board set). */
export function EntitlementValueEditor({
  id,
  entKey,
  label,
  value,
  onChange,
  invalid = false,
}: {
  id: string;
  entKey: EntitlementKey;
  label: string;
  value: unknown;
  onChange: (value: unknown) => void;
  invalid?: boolean;
}) {
  const { t } = useTranslation();
  const lastNumber = useRef<number>(typeof value === 'number' ? value : 0);
  const kind = entitlementKind(entKey);

  if (kind === 'feature')
    return (
      <label className="flex items-center gap-2 text-sm">
        <input
          id={id}
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
        {label}
      </label>
    );

  if (kind === 'quota') {
    const unlimited = value === null;
    return (
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={id} className="text-sm">
          {label}
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <input
            id={id}
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            dir="ltr"
            aria-invalid={invalid}
            disabled={unlimited}
            className={`${inputClass} w-32`}
            value={unlimited ? '' : typeof value === 'number' ? String(value) : String(value ?? '')}
            onChange={(e) => {
              const raw = e.target.value;
              const n = Number(raw);
              if (raw !== '' && Number.isFinite(n)) {
                lastNumber.current = n;
                onChange(n);
              } else onChange(raw);
            }}
          />
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={unlimited}
              aria-label={t('admin:editor.unlimitedFor', { name: label })}
              onChange={(e) => onChange(e.target.checked ? null : lastNumber.current)}
            />
            {t('admin:value.unlimited')}
          </label>
        </div>
      </div>
    );
  }

  if (kind === 'boards') {
    const selected = Array.isArray(value) ? (value as string[]) : [];
    return (
      <fieldset className="flex min-w-0 flex-col gap-1" aria-invalid={invalid}>
        <legend className="text-sm">{label}</legend>
        <div className="flex flex-wrap gap-3">
          {BUILD_BOARDS.map((board) => (
            <label key={board} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={selected.includes(board)}
                onChange={(e) =>
                  onChange(e.target.checked ? [...selected, board] : selected.filter((b) => b !== board))
                }
              />
              {t(`admin:board.${board}`)}
            </label>
          ))}
        </div>
      </fieldset>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-sm">
        {label}
      </label>
      <select
        id={id}
        className={inputClass}
        aria-invalid={invalid}
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
      >
        {settingOptions(entKey).map((option) => (
          <option key={option} value={option}>
            {t(`admin:settingValue.${option}`)}
          </option>
        ))}
      </select>
    </div>
  );
}
