import { BUILTIN_ARENAS, type BuiltinArena } from '@robosim/content/arenas';
import { ArenaRenderer, type RobotView } from '@robosim/renderer-2d';
import { Button, cn } from '@robosim/ui';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { arenaViewOf } from './arena-model.js';

const THUMB_W = 192;
const THUMB_H = 120;

/** An arena drawn from its spec, with the robot at the default start (US-ARN-04 thumbnails). */
export function ArenaThumbnail({ arena, robot }: { arena: BuiltinArena; robot: RobotView | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = THUMB_W * dpr;
    canvas.height = THUMB_H * dpr;
    new ArenaRenderer(ctx, arenaViewOf(arena), robot).draw({ pose: arena.spec.start, trail: false });
  }, [arena, robot]);
  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="h-[120px] w-[192px] rounded border border-line bg-surface"
    />
  );
}

/** Built-in arena picker (FR-ARN-05): every arena with a thumbnail, its family and its goal. */
export function ArenaPicker({
  current,
  robot,
  onPick,
  onClose,
}: {
  current: string | null;
  robot: RobotView | null;
  /** null = take the project off the arena (bench). */
  onPick: (arenaId: string | null) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => close.current?.focus(), []);
  const card = (selected: boolean) =>
    cn(
      'flex flex-col items-start gap-1 rounded-lg border p-2 text-start hover:bg-surface-raised',
      selected ? 'border-brand-600 ring-2 ring-brand-600/40' : 'border-line',
    );
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="arena-picker-title"
        className="max-h-[90vh] w-[min(56rem,95vw)] overflow-y-auto rounded-lg border border-line bg-surface p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <h2 id="arena-picker-title" className="mb-3 text-lg font-semibold">
          {t('shell:arena.picker.title')}
        </h2>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-3">
          {BUILTIN_ARENAS.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                className={card(a.id === current)}
                aria-current={a.id === current ? 'true' : undefined}
                onClick={() => onPick(a.id)}
              >
                <ArenaThumbnail arena={a} robot={robot} />
                <span className="font-medium">{t(`shell:arenas.${a.id}.name`)}</span>
                <span className="text-xs text-ink-muted">
                  {t(`shell:arena.family.${a.family}`)} ·{' '}
                  {a.challenge ? t(`shell:arenas.${a.id}.goal`) : t('shell:arena.picker.noChallenge')}
                </span>
              </button>
            </li>
          ))}
          <li>
            <button type="button" className={card(current === null)} onClick={() => onPick(null)}>
              <span className="flex h-[120px] w-[192px] items-center justify-center rounded border border-dashed border-line text-sm text-ink-muted">
                {t('shell:arena.picker.none')}
              </span>
              <span className="font-medium">{t('shell:arena.picker.none')}</span>
              <span className="text-xs text-ink-muted">{t('shell:arena.picker.noneDescription')}</span>
            </button>
          </li>
        </ul>
        <div className="mt-4 flex justify-end">
          <Button ref={close} size="sm" variant="secondary" onClick={onClose}>
            {t('shell:arena.picker.close')}
          </Button>
        </div>
      </div>
    </div>
  );
}
