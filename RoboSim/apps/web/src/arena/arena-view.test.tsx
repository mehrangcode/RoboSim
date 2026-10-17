import { findArena } from '@robosim/content/arenas';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { initI18n } from '../lib/i18n.js';
import { arenaViewOf } from './arena-model.js';
import { ArenaView } from './arena-view.js';

const oval = findArena('oval');
if (!oval) throw new Error('oval');

describe('ArenaView', () => {
  it('toggles follow / trail / sensors and remembers them (FR-ARN-07)', async () => {
    localStorage.removeItem('robosim.arena.view.v1');
    const i18n = await initI18n('en');
    const user = userEvent.setup();
    render(
      <I18nextProvider i18n={i18n}>
        <ArenaView arena={arenaViewOf(oval)} robot={null} label="Arena: Oval" />
      </I18nextProvider>,
    );
    expect(screen.getByRole('img', { name: 'Arena: Oval' })).toBeInTheDocument();
    const toolbar = screen.getByRole('toolbar', { name: 'Arena view' });
    expect(toolbar).toBeInTheDocument();
    const trail = screen.getByRole('button', { name: 'Trail' });
    expect(trail).toHaveAttribute('aria-pressed', 'true');
    await user.click(trail);
    await user.click(screen.getByRole('button', { name: 'Sensors' }));
    expect(trail).toHaveAttribute('aria-pressed', 'false');
    expect(JSON.parse(localStorage.getItem('robosim.arena.view.v1') ?? '{}')).toEqual({
      follow: false,
      trail: false,
      overlays: true,
    });
  });

  it('explains how to place the robot while editing the start pose (FR-ARN-06)', async () => {
    const i18n = await initI18n('en');
    render(
      <I18nextProvider i18n={i18n}>
        <ArenaView
          arena={arenaViewOf(oval)}
          robot={null}
          label="Arena: Oval"
          edit={{ pose: { x: 0.9, y: 0.3, angle: 0 }, check: () => ({ kind: 'outside' }), onChange: vi.fn() }}
        />
      </I18nextProvider>,
    );
    expect(screen.getByText('The robot would hang off the mat.')).toBeInTheDocument();
  });
});
