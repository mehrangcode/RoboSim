import { useCircuitEditor, type CircuitEditorState } from '@robosim/circuit-canvas';
import type { ProjectDocument } from '@robosim/shared';
import { builtinSource } from '@robosim/sim-runtime';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import { initI18n } from '../lib/i18n.js';
import { RobotView } from './robot-view.js';

async function setup(doc: ProjectDocument = builtinSource('line-follower').project, disabled = false) {
  const i18n = await initI18n('en');
  const state: { editor: CircuitEditorState | null } = { editor: null };
  function Harness() {
    const editor = useCircuitEditor(doc);
    state.editor = editor;
    return <RobotView editor={editor} disabled={disabled} />;
  }
  render(
    <I18nextProvider i18n={i18n}>
      <Harness />
    </I18nextProvider>,
  );
  const mountOf = (id: string) => state.editor?.doc.components.find((c) => c.id === id)?.mount;
  return { user: userEvent.setup(), state, mountOf };
}

const part = (name: RegExp) =>
  within(screen.getByRole('group', { name: /Robot from above/ })).getByRole('button', { name });

describe('RobotView (FR-ARN-09, US-ARN-06)', () => {
  it('US-ARN-06 AC1 moves the line sensor 2 cm forward with the exact field', async () => {
    const { user, mountOf } = await setup();
    await user.click(part(/^3-channel line sensor \(line\)/));
    const x = screen.getByLabelText('x (mm, forward)');
    expect(x).toHaveValue(65);
    await user.clear(x);
    await user.type(x, '85{Enter}');
    expect(mountOf('line')).toEqual({ x: 85, y: 0, z: 5, yaw: 0 });
    expect(part(/^3-channel line sensor \(line\): x 85 mm/)).toBeInTheDocument();
  });

  it('refuses a spot off the chassis and says why', async () => {
    const { user, mountOf } = await setup();
    await user.click(part(/\(drv\)/));
    const y = screen.getByLabelText('y (mm, left)');
    await user.clear(y);
    await user.type(y, '200{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('That is off the chassis');
    expect(mountOf('drv')?.y).toBe(0);
  });

  it('nudges and turns with the keyboard, takes parts off and mounts them again', async () => {
    const { user, mountOf } = await setup();
    part(/\(drv\)/).focus();
    await user.keyboard('{ArrowUp}{Shift>}{ArrowLeft}{/Shift}r');
    expect(mountOf('drv')).toEqual({ x: -29, y: 10, z: 45, yaw: 15 });
    await user.keyboard('{Delete}');
    expect(mountOf('drv')).toBeUndefined();
    const tray = screen.getByRole('region', { name: 'Not on the robot' });
    await user.click(within(tray).getByRole('button', { name: 'Mount' }));
    expect(mountOf('drv')).toMatchObject({ x: -30, y: 0 });
    expect(screen.getByText('Every part that can be mounted is on the robot.')).toBeInTheDocument();
  });

  it('motors switch sides only; a missing side is flagged', async () => {
    const { user, mountOf } = await setup();
    await user.click(part(/\(motorL\)/));
    await user.click(screen.getByRole('radio', { name: 'Right' }));
    expect(mountOf('motorL')?.y).toBe(-45);
    expect(
      screen.getByText('Mount one TT motor on each side, or the robot cannot drive.'),
    ).toBeInTheDocument();
  });

  it('wheels are chassis props within the manifest range; mass distribution is shown', async () => {
    const { user, mountOf } = await setup();
    const track = screen.getByLabelText('Track width (mm)');
    await user.clear(track);
    await user.type(track, '400{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('Allowed range: 60–300');
    await user.clear(track);
    await user.type(track, '160{Enter}');
    expect(mountOf('motorR')?.y).toBe(-60);
    const mass = screen.getByRole('region', { name: 'Mass distribution' });
    expect(mass).toHaveTextContent('Total');
    expect(mass).toHaveTextContent(/\d+ g/);
    expect(mass).toHaveTextContent('On drive wheels');
  });

  it('warns about parts that take the same space', async () => {
    const doc = builtinSource('line-follower').project;
    const stacked = {
      ...doc,
      components: doc.components.map((c) =>
        c.id === 'bat' ? { ...c, mount: { x: -30, y: 0, z: 45, yaw: 0 } } : c,
      ),
    };
    await setup(stacked);
    expect(screen.getByText('bat and drv take the same space.')).toBeInTheDocument();
  });

  it('selects a part hidden under the stack from the list and draws it on top', async () => {
    const { user } = await setup();
    const list = screen.getByRole('region', { name: 'On the robot' });
    await user.click(within(list).getByRole('button', { name: /\(drv\)/ }));
    expect(screen.getByRole('heading', { name: 'L298N motor driver (drv)' })).toBeInTheDocument();
    const drawn = within(screen.getByRole('group', { name: /Robot from above/ })).getAllByRole('button');
    expect(drawn.at(-1)).toHaveAccessibleName(/\(drv\)/);
  });

  it('is read-only while a run is live', async () => {
    const { user } = await setup(undefined, true);
    await user.click(part(/\(drv\)/));
    expect(screen.getByLabelText('x (mm, forward)')).toBeDisabled();
    expect(screen.getByLabelText('Track width (mm)')).toBeDisabled();
  });
});
