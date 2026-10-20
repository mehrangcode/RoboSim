import type { FindingView } from '@robosim/sim-runtime/client';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import { initI18n } from '../lib/i18n.js';
import { SketchPanel } from './sketch-panel.js';

const code = 'void setup() {}\nvoid loop() {\n  analogWrite(7, 128);\n}\n';
const pwm: FindingView = {
  ruleId: 'SAF-CODE-PWM-PIN',
  severity: 'warning',
  kind: 'static',
  componentIds: [],
  pinIds: ['D7'],
  messageKey: 'safety:SAF-CODE-PWM-PIN',
  params: { pin: 'D7', pwmPins: '3, 5, 6, 9, 10, 11' },
  codeRefs: [{ file: 'sketch.ino', line: 3, column: 3 }],
};

async function panel(findings: readonly FindingView[]) {
  const i18n = await initI18n('en');
  render(
    <I18nextProvider i18n={i18n}>
      <SketchPanel
        files={[{ name: 'sketch.ino', content: code }]}
        onChange={() => undefined}
        state={{ status: 'idle' }}
        modified={false}
        findings={findings}
      />
    </I18nextProvider>,
  );
}

describe('sketch panel: code-aware safety (FR-SAF-03)', () => {
  it('US-SAF-02 AC1: lists the warning at its code line with the fix, and jumps to the line', async () => {
    await panel([
      pwm,
      { ...pwm, ruleId: 'SAF-SHORT-CIRCUIT', codeRefs: undefined } as unknown as FindingView,
    ]);
    const list = screen.getByRole('list', { name: 'Safety checks in the code' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(1); // wiring-only findings stay in the Safety panel
    expect(items[0]).toHaveTextContent('Warning');
    expect(items[0]).toHaveTextContent('sketch.ino, line 3, column 3');
    expect(items[0]).toHaveTextContent('analogWrite on pin D7, which has no PWM');
    expect(items[0]).toHaveTextContent(
      'Move the wire and the code to one of the PWM pins 3, 5, 6, 9, 10, 11.',
    );

    await userEvent.click(within(items[0] as HTMLElement).getByRole('button'));
    const editor = screen.getByRole('textbox', { name: 'Arduino code' }) as HTMLTextAreaElement;
    expect(editor.value.slice(editor.selectionStart, editor.selectionEnd)).toBe('  analogWrite(7, 128);');
  });

  it('shows no code-safety list without code-aware findings', async () => {
    await panel([]);
    expect(screen.queryByRole('list', { name: 'Safety checks in the code' })).toBeNull();
  });
});
