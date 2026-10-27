import { Button } from '@robosim/ui';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useFormat } from '../lab/format.js';
import { TOUR_STOPS, type TourStop } from './tour-state.js';

interface Placement {
  readonly box: DOMRect | null;
}

const find = (stop: TourStop) => document.querySelector<HTMLElement>(`[data-tour="${stop}"]`);

/** A visible target's box, or null (collapsed pane, narrow layout): the card is then centred. */
function placementOf(stop: TourStop): Placement {
  const el = find(stop);
  const box = el?.getBoundingClientRect();
  return { box: box && box.width > 0 && box.height > 0 ? box : null };
}

const CARD_W = 320;
const GAP = 12;

function cardStyle(box: DOMRect | null): CSSProperties {
  if (!box) return { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.min(Math.max(GAP, box.left + box.width / 2 - CARD_W / 2), vw - CARD_W - GAP);
  // Below the target when there is room, otherwise above it, otherwise over its top edge.
  if (box.bottom + GAP + 180 < vh) return { left, top: box.bottom + GAP };
  if (box.top - GAP - 180 > 0) return { left, bottom: vh - box.top + GAP };
  return { left, top: Math.max(GAP, box.top + GAP) };
}

/**
 * The editor tour (FR-WRK-06): a card per stop next to the part of the workspace it explains, with
 * the rest dimmed. Skippable at every step (Escape too); finishing or skipping calls `onDone`.
 */
export function OnboardingTour({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  const [index, setIndex] = useState(0);
  const stop = TOUR_STOPS[index] ?? 'welcome';
  const [placement, setPlacement] = useState<Placement>({ box: null });
  const card = useRef<HTMLDivElement>(null);
  const last = index === TOUR_STOPS.length - 1;

  useLayoutEffect(() => {
    const update = () => setPlacement(placementOf(stop));
    find(stop)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [stop]);
  useEffect(() => card.current?.focus(), [index]);

  const { box } = placement;
  return createPortal(
    <div className="fixed inset-0 z-40">
      {box ? (
        // Spotlight: the target stays bright, everything around it dims.
        <div
          className="pointer-events-none absolute rounded-md ring-2 ring-brand-500"
          style={{
            left: box.left - 4,
            top: box.top - 4,
            width: box.width + 8,
            height: box.height + 8,
            boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.45)',
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/45" />
      )}
      <div
        ref={card}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        className="absolute flex flex-col gap-2 rounded-lg border border-line bg-surface p-4 shadow-xl outline-none"
        style={{ width: CARD_W, maxWidth: `calc(100vw - ${2 * GAP}px)`, ...cardStyle(box) }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onDone();
          else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            // Arrow keys follow reading direction: in RTL "forward" is the left arrow.
            const rtl = document.documentElement.dir === 'rtl';
            const forward = (e.key === 'ArrowRight') !== rtl;
            setIndex((i) => Math.min(TOUR_STOPS.length - 1, Math.max(0, i + (forward ? 1 : -1))));
          }
        }}
      >
        <p className="text-xs text-ink-muted">
          {t('shell:tour.progress', { step: fmt(index + 1, 0), total: fmt(TOUR_STOPS.length, 0) })}
        </p>
        <h2 id="tour-title" className="text-base font-semibold">
          {t(`shell:tour.stops.${stop}.title`)}
        </h2>
        <p id="tour-body" className="text-sm">
          {t(`shell:tour.stops.${stop}.body`)}
        </p>
        <div className="mt-2 flex items-center gap-2">
          {!last && (
            <Button size="sm" variant="ghost" onClick={onDone}>
              {t('shell:tour.skip')}
            </Button>
          )}
          <div className="ms-auto flex gap-2">
            {index > 0 && (
              <Button size="sm" variant="secondary" onClick={() => setIndex(index - 1)}>
                {t('shell:tour.back')}
              </Button>
            )}
            <Button size="sm" onClick={() => (last ? onDone() : setIndex(index + 1))}>
              {last ? t('shell:tour.done') : t('shell:tour.next')}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
