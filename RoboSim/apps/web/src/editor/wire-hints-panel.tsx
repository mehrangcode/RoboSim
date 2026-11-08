import {
  DEFAULT_WIRE_CONVENTION,
  WIRE_COLORS,
  hintKey,
  type WireConvention,
  type WireHint,
} from '@robosim/circuit-canvas';
import { BOARD_PART, type PinRef, type ProjectDocument } from '@robosim/shared';
import { Button, Card, cn } from '@robosim/ui';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

const ROLES = ['ground', 'supply'] as const;
const INFO_ICON = 'ℹ️';
const GEAR_ICON = '⚙';

const LINT_KEY = {
  'LINT-WIRE-LONG': 'long',
  'LINT-WIRE-OVER-PART': 'overPart',
  'LINT-WIRE-OVERLAP': 'overlap',
} as const;

/**
 * Wiring hints (FR-CIR-11): readability tips in their own group of the Safety tab, apart from the safety
 * findings and not counted in the tab's badge. Each can be shown on the circuit or dismissed (kept per
 * project); ⚙ sets the colour convention.
 */
export function WireHintsPanel({
  doc,
  hints,
  dismissed,
  onDismiss,
  onRestore,
  selected,
  onSelect,
  convention,
  onConventionChange,
  onTidy,
}: {
  doc: ProjectDocument;
  hints: readonly WireHint[];
  dismissed: ReadonlySet<string>;
  onDismiss: (key: string) => void;
  onRestore: (key: string) => void;
  selected: string | null;
  onSelect: (key: string | null) => void;
  convention: WireConvention;
  onConventionChange: (conv: WireConvention) => void;
  onTidy: () => void;
}) {
  const { t, i18n } = useTranslation();
  const settingsId = useId();
  const [settings, setSettings] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  const active = hints.filter((h) => !dismissed.has(hintKey(h)));
  const gone = hints.filter((h) => dismissed.has(hintKey(h)));
  const list = showDismissed ? [...active, ...gone] : active;

  const colour = (name: string | number | undefined) =>
    typeof name === 'string' ? t(`editor:color.${name}`, { defaultValue: name }) : '';
  const partName = (id: string) => {
    const type = doc.components.find((c) => c.id === id)?.type;
    return type ? t(`components:${type}.name`) : id;
  };
  const endLabel = (r: PinRef) =>
    r.part === BOARD_PART ? t('editor:hints.board', { pin: r.pin }) : `${partName(r.part)} (${r.pin})`;
  const wireLabel = (id: string | undefined) => {
    const w = doc.wires.find((v) => v.id === id);
    return w ? `${endLabel(w.from)} → ${endLabel(w.to)}` : (id ?? '');
  };
  const listSep = i18n.language.startsWith('fa') ? '، ' : ', ';

  const text = (h: WireHint): { title: string; why: string } => {
    const wire = wireLabel(h.wireIds[0]);
    if (h.id === 'LINT-WIRE-COLOR') {
      const role = String(h.params['role']);
      return {
        title: t(`editor:lint.color.${role}`, {
          wire,
          color: colour(h.params['color']).toLocaleLowerCase(i18n.language),
        }),
        why: t('editor:lint.color.why', {
          supply: colour(convention.supply),
          ground: colour(convention.ground).toLocaleLowerCase(i18n.language),
        }),
      };
    }
    if (h.id === 'LINT-RAIL-HINT') {
      const role = String(h.params['role']);
      return {
        title: t(`editor:lint.rail.${role}`, { count: h.params['count'] }),
        why: t('editor:lint.rail.why', { rail: role === 'ground' ? '−' : '+' }),
      };
    }
    const key = LINT_KEY[h.id];
    return {
      title: t(`editor:lint.${key}.title`, {
        wire,
        other: wireLabel(h.wireIds[1]),
        length: h.params['length'],
        parts: h.partIds.map(partName).join(listSep),
      }),
      why: t(`editor:lint.${key}.why`),
    };
  };

  const choose = (role: 'ground' | 'supply', value: string) =>
    onConventionChange({ ...convention, [role]: value });

  return (
    <Card className="p-3">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-ink-muted">
          {t('editor:hints.title')}
          {active.length > 0 && ` (${active.length})`}
        </h2>
        <span className="ms-auto flex gap-1.5">
          <Button size="sm" variant="secondary" onClick={onTidy} disabled={doc.wires.length === 0}>
            {t('editor:hints.tidy')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={settings}
            aria-controls={settingsId}
            title={t('editor:hints.settings')}
            aria-label={t('editor:hints.settings')}
            onClick={() => setSettings(!settings)}
          >
            <span aria-hidden>{GEAR_ICON}</span>
          </Button>
        </span>
      </div>
      <p className="text-xs text-ink-muted">{t('editor:hints.intro')}</p>
      {settings && (
        <fieldset id={settingsId} className="mt-2 grid gap-2 rounded-md border border-line p-2 text-sm">
          <legend className="px-1 text-xs font-semibold text-ink-muted">{t('editor:hints.settings')}</legend>
          {ROLES.map((role) => (
            <label key={role} className="flex items-center justify-between gap-2">
              {t(`editor:hints.${role}`)}
              <select
                value={convention[role]}
                onChange={(e) => choose(role, e.target.value)}
                className="rounded border border-line bg-surface px-1 py-0.5"
              >
                {Object.keys(WIRE_COLORS)
                  .filter((c) => c !== convention[role === 'ground' ? 'supply' : 'ground'])
                  .map((c) => (
                    <option key={c} value={c}>
                      {colour(c)}
                    </option>
                  ))}
              </select>
            </label>
          ))}
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={convention.signalAvoid}
              onChange={(e) => onConventionChange({ ...convention, signalAvoid: e.target.checked })}
            />
            {t('editor:hints.signalAvoid')}
          </label>
          <Button
            size="sm"
            variant="ghost"
            className="justify-self-start"
            onClick={() => onConventionChange(DEFAULT_WIRE_CONVENTION)}
          >
            {t('editor:hints.reset')}
          </Button>
        </fieldset>
      )}
      {list.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">{t('editor:hints.none')}</p>
      ) : (
        <ul className="mt-2 grid gap-2" aria-label={t('editor:hints.title')}>
          {list.map((h) => {
            const key = hintKey(h);
            const off = dismissed.has(key);
            const { title, why } = text(h);
            return (
              <li
                key={key}
                data-hint={h.id}
                className={cn(
                  'rounded-md border border-line p-2 text-sm',
                  off && 'opacity-60',
                  selected === key && 'ring-2 ring-accent',
                )}
              >
                <p className="flex items-center gap-x-2 text-xs text-ink-muted">
                  <span aria-hidden>{INFO_ICON}</span>
                  {t('editor:hints.kind')}
                </p>
                <p className="mt-1 font-medium">{title}</p>
                <p className="mt-1 text-xs">{why}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {!off && (
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-pressed={selected === key}
                      onClick={() => onSelect(selected === key ? null : key)}
                    >
                      {t(selected === key ? 'editor:hints.hide' : 'editor:hints.show')}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (off) onRestore(key);
                      else {
                        if (selected === key) onSelect(null);
                        onDismiss(key);
                      }
                    }}
                  >
                    {t(off ? 'editor:hints.restore' : 'editor:hints.dismiss')}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {gone.length > 0 && (
        <Button size="sm" variant="ghost" className="mt-2" onClick={() => setShowDismissed(!showDismissed)}>
          {showDismissed
            ? t('editor:hints.hideDismissed')
            : t('editor:hints.showDismissed', { count: gone.length })}
        </Button>
      )}
    </Card>
  );
}
