import { RuleTester } from 'eslint';
import { describe, it, expect } from 'vitest';
import tseslint from 'typescript-eslint';
import rule, { logicalReplacement } from '../eslint/rules/no-physical-direction-classes.js';

RuleTester.describe = describe;
RuleTester.it = it;

describe('FR-I18N-02 logicalReplacement', () => {
  it.each([
    ['ml-2', 'ms-2'],
    ['md:pr-4', 'md:pe-4'],
    ['-left-1', '-start-1'],
    ['hover:!text-left', 'hover:!text-start'],
    ['rounded-tl-lg', 'rounded-ss-lg'],
    ['border-r', 'border-e'],
    ['scroll-ml-6', 'scroll-ms-6'],
  ])('%s → %s', (input, expected) => expect(logicalReplacement(input)).toBe(expected));

  it.each(['ms-2', 'text-start', 'flex', 'leading-6', 'rounded-lg', 'translate-x-1', 'mx-auto'])(
    'accepts %s',
    (token) => expect(logicalReplacement(token)).toBeNull(),
  );
});

new RuleTester({
  languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
}).run('no-physical-direction-classes', rule, {
  valid: [
    { code: '<div className="ms-2 pe-4 text-start" />' },
    { code: 'cn("ps-2", cond && "me-1")' },
    { code: 'const label = "ml-2 is fine outside class contexts"' },
  ],
  invalid: [
    { code: '<div className="ml-2 flex" />', errors: [{ messageId: 'physical' }] },
    { code: '<div className={`p-2 ${x} text-right`} />', errors: [{ messageId: 'physical' }] },
    { code: 'cn("pl-2", "right-0")', errors: [{ messageId: 'physical' }, { messageId: 'physical' }] },
  ],
});
