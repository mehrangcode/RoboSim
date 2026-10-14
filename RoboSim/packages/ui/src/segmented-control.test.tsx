import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { SegmentedControl } from './segmented-control.js';

const OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'fa', label: 'فارسی', lang: 'fa' },
] as const;

function Harness({ dir }: { dir: 'ltr' | 'rtl' }) {
  const [value, setValue] = useState<'en' | 'fa'>('en');
  return (
    <div dir={dir} style={{ direction: dir }}>
      <SegmentedControl label="Language" value={value} options={OPTIONS} onChange={setValue} />
    </div>
  );
}

describe('SegmentedControl (NFR-A11Y-01 keyboard operability)', () => {
  it('exposes a radio group with the selected option checked', () => {
    render(<Harness dir="ltr" />);
    expect(screen.getByRole('radiogroup', { name: 'Language' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'English' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'فارسی' })).toHaveAttribute('tabindex', '-1');
  });

  it('moves with ArrowRight in LTR', async () => {
    render(<Harness dir="ltr" />);
    screen.getByRole('radio', { name: 'English' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'فارسی' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'فارسی' })).toHaveFocus();
  });

  it('moves with ArrowLeft in RTL (visual order)', async () => {
    render(<Harness dir="rtl" />);
    screen.getByRole('radio', { name: 'English' }).focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('radio', { name: 'فارسی' })).toHaveAttribute('aria-checked', 'true');
  });

  it('selects on click', async () => {
    render(<Harness dir="ltr" />);
    await userEvent.click(screen.getByRole('radio', { name: 'فارسی' }));
    expect(screen.getByRole('radio', { name: 'فارسی' })).toHaveAttribute('aria-checked', 'true');
  });
});
