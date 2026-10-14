import { useRef, type KeyboardEvent } from 'react';
import { cn } from './cn.js';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** BCP 47 language of the label, for screen readers (e.g. a "فارسی" option inside an English page). */
  lang?: string;
}

export interface SegmentedControlProps<T extends string> {
  label: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
}

/** WAI-ARIA radio group with roving focus; arrow keys follow the visual order in both LTR and RTL. */
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: SegmentedControlProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
    const backward = rtl ? 'ArrowRight' : 'ArrowLeft';
    if (event.key !== forward && event.key !== backward) return;
    event.preventDefault();
    const index = options.findIndex((o) => o.value === value);
    const next = (index + (event.key === forward ? 1 : -1) + options.length) % options.length;
    const option = options[next];
    if (!option) return;
    onChange(option.value);
    refs.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="inline-flex rounded-md border border-line bg-surface p-0.5 text-sm"
    >
      {options.map((option, i) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            lang={option.lang}
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded px-3 py-1 transition-colors',
              checked ? 'bg-surface-raised font-medium text-ink shadow-sm' : 'text-ink-muted hover:text-ink',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
