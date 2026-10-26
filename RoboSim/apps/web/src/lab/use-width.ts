import { useLayoutEffect, useState, type RefObject } from 'react';

/** Content width of an element in CSS px, following resizes (`fallback` where layout is unavailable). */
export function useWidth(ref: RefObject<HTMLElement | null>, fallback = 600): number {
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => setWidth(el.clientWidth || fallback);
    fit();
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, fallback]);
  return width;
}
