import { addApiDocs } from '@robosim/i18n/apidocs';
import { ARDUINO_API } from '@robosim/shared';
import { describe, expect, it } from 'vitest';
import { initI18n } from '../lib/i18n.js';
import { apiDocMarkdown } from './api-docs.js';

/** The value, or a failed test when it is missing. */
function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected a value');
  return value;
}

const attach = must(ARDUINO_API.find((e) => e.of === 'Servo' && e.name === 'attach'));

describe('API hover docs (FR-COD-02)', () => {
  it('renders signature, parameters, return value, example and include in the UI language', async () => {
    const i18n = await initI18n('en');
    addApiDocs(i18n);
    const en = must(apiDocMarkdown(attach, i18n.t));
    expect(en).toContain('uint8_t Servo::attach(int pin, int min, int max)');
    expect(en).toContain('- `min` — Pulse width in microseconds for 0 degrees');
    expect(en).toContain('**Returns:**');
    expect(en).toContain('`#include <Servo.h>`');

    await i18n.changeLanguage('fa');
    const fa = must(apiDocMarkdown(attach, i18n.t));
    expect(fa).toContain('سروو را به یک پایه وصل می‌کند');
    expect(fa).toContain('**پارامترها**');
  });

  it('has no doc for an unknown entry', async () => {
    const i18n = await initI18n('en');
    addApiDocs(i18n);
    expect(apiDocMarkdown({ name: 'nope', kind: 'function', detail: 'void nope()' }, i18n.t)).toBeUndefined();
  });
});
