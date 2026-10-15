import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { cn } from './cn.js';

export interface ResizeHandleProps {
  /** `vertical`: a bar between columns (drag sideways); `horizontal`: between rows. */
  orientation: 'vertical' | 'horizontal';
  /** Accessible name, e.g. "Resize the code pane". */
  label: string;
  /** Size in px of the pane this handle resizes. */
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  /**
   * Where that pane sits relative to the handle: `start` = before it (left in LTR, right in RTL,
   * above for rows). Dragging towards the pane shrinks it.
   */
  side: 'start' | 'end';
  className?: string;
}

const KEY_STEP = 16;

/** Pane splitter (WAI-ARIA window splitter): pointer drag, arrow keys, Home/End; mirrors in RTL. */
export function ResizeHandle({
  orientation,
  label,
  value,
  min,
  max,
  onChange,
  side,
  className,
}: ResizeHandleProps) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ start: number; value: number; sign: number } | null>(null);
  const clamp = (v: number) => Math.round(Math.min(max, Math.max(min, v)));
  const sign = () => {
    const rtl = orientation === 'vertical' && ref.current?.closest('[dir]')?.getAttribute('dir') === 'rtl';
    return (side === 'start' ? 1 : -1) * (rtl ? -1 : 1);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { start: orientation === 'vertical' ? e.clientX : e.clientY, value, sign: sign() };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const pos = orientation === 'vertical' ? e.clientX : e.clientY;
    onChange(clamp(d.value + (pos - d.start) * d.sign));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const grow = orientation === 'vertical' ? 'ArrowRight' : 'ArrowDown';
    const shrink = orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp';
    if (e.key === grow) onChange(clamp(value + KEY_STEP * sign()));
    else if (e.key === shrink) onChange(clamp(value - KEY_STEP * sign()));
    else if (e.key === 'Home') onChange(min);
    else if (e.key === 'End') onChange(max);
    else return;
    e.preventDefault();
  };

  return (
    <div
      ref={ref}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={orientation}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => (drag.current = null)}
      onKeyDown={onKeyDown}
      className={cn(
        'shrink-0 touch-none bg-line/60 outline-none transition-colors hover:bg-accent focus-visible:bg-accent',
        orientation === 'vertical' ? 'w-1.5 cursor-col-resize' : 'h-1.5 cursor-row-resize',
        className,
      )}
    />
  );
}
