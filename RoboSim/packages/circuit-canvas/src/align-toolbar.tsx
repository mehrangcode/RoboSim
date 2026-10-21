import { useTranslation } from 'react-i18next';
import type { Alignment } from './document.js';

type Action = Alignment | 'distributeH' | 'distributeV';

/** Icon shapes for the horizontal actions, as [x, y, w, h] in a 16 × 16 box; vertical ones are transposed. */
const LINE_AND_BARS: Readonly<Record<'left' | 'center' | 'right' | 'distributeH', readonly number[][]>> = {
  left: [
    [2, 1, 1.2, 14],
    [4, 4, 9, 3],
    [4, 9, 5, 3],
  ],
  center: [
    [7.4, 1, 1.2, 14],
    [3, 4, 10, 3],
    [5, 9, 6, 3],
  ],
  right: [
    [12.8, 1, 1.2, 14],
    [3, 4, 9, 3],
    [7, 9, 5, 3],
  ],
  distributeH: [
    [1, 3, 3, 10],
    [6.5, 5, 3, 6],
    [12, 2, 3, 12],
  ],
};
const TRANSPOSED: Readonly<Record<string, keyof typeof LINE_AND_BARS>> = {
  top: 'left',
  middle: 'center',
  bottom: 'right',
  distributeV: 'distributeH',
};
const ACTIONS: readonly Action[] = [
  'left',
  'center',
  'right',
  'top',
  'middle',
  'bottom',
  'distributeH',
  'distributeV',
];

function Icon({ action }: { action: Action }) {
  const flip = TRANSPOSED[action];
  const shapes = LINE_AND_BARS[flip ?? (action as keyof typeof LINE_AND_BARS)];
  return (
    <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true" fill="currentColor">
      {shapes.map(([x = 0, y = 0, w = 0, h = 0], i) =>
        flip ? (
          <rect key={i} x={y} y={x} width={h} height={w} />
        ) : (
          <rect key={i} x={x} y={y} width={w} height={h} />
        ),
      )}
    </svg>
  );
}

/** Align and distribute for two or more selected parts (FR-CIR-01). */
export function AlignToolbar({
  count,
  onAlign,
  onDistribute,
}: {
  /** Selected parts that move on their own. */
  count: number;
  onAlign: (how: Alignment) => void;
  onDistribute: (axis: 'horizontal' | 'vertical') => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="toolbar"
      aria-label={t('editor:align.label')}
      className="flex gap-0.5 rounded border border-line bg-surface p-0.5 shadow-sm"
    >
      {ACTIONS.map((a) => {
        const distribute = a === 'distributeH' || a === 'distributeV';
        return (
          <button
            key={a}
            type="button"
            title={t(`editor:align.${a}`)}
            aria-label={t(`editor:align.${a}`)}
            disabled={distribute ? count < 3 : count < 2}
            onClick={() =>
              distribute ? onDistribute(a === 'distributeH' ? 'horizontal' : 'vertical') : onAlign(a)
            }
            className="grid size-7 place-items-center rounded text-ink hover:bg-surface-raised disabled:opacity-40"
          >
            <Icon action={a} />
          </button>
        );
      })}
    </div>
  );
}
