import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ResizeHandle } from './resize-handle.js';

function setup(side: 'start' | 'end', dir: 'ltr' | 'rtl' = 'ltr') {
  const onChange = vi.fn();
  render(
    <div dir={dir}>
      <ResizeHandle
        orientation="vertical"
        label="Resize"
        value={200}
        min={100}
        max={400}
        side={side}
        onChange={onChange}
      />
    </div>,
  );
  return { onChange, handle: screen.getByRole('separator', { name: 'Resize' }) };
}

describe('ResizeHandle', () => {
  it('is a focusable window splitter with its current size', () => {
    const { handle } = setup('start');
    expect(handle).toHaveAttribute('aria-valuenow', '200');
    expect(handle).toHaveAttribute('aria-orientation', 'vertical');
    expect(handle).toHaveAttribute('tabindex', '0');
  });

  it('drags: a pane before the handle grows with the pointer, a pane after it shrinks', () => {
    const start = setup('start');
    fireEvent.pointerDown(start.handle, { clientX: 300 });
    fireEvent.pointerMove(start.handle, { clientX: 350 });
    expect(start.onChange).toHaveBeenLastCalledWith(250);
    fireEvent.pointerMove(start.handle, { clientX: 900 });
    expect(start.onChange).toHaveBeenLastCalledWith(400);
  });

  it('mirrors in RTL and works from the keyboard', () => {
    const { onChange, handle } = setup('start', 'rtl');
    fireEvent.pointerDown(handle, { clientX: 300 });
    fireEvent.pointerMove(handle, { clientX: 250 });
    expect(onChange).toHaveBeenLastCalledWith(250);
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith(216);
    fireEvent.keyDown(handle, { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith(100);
  });

  it('end side shrinks when dragged towards the pane', () => {
    const { onChange, handle } = setup('end');
    fireEvent.pointerDown(handle, { clientX: 300 });
    fireEvent.pointerMove(handle, { clientX: 340 });
    expect(onChange).toHaveBeenLastCalledWith(160);
  });
});
