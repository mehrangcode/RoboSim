import { describe, expect, it } from 'vitest';
import { resources } from '@robosim/i18n';
import { EXPLANATION_KEYS, explain } from '../src/explanations.js';

// One real avr-gcc 7.3 / ld message per catalogued error (FR-COD-03).
const SAMPLES: Record<string, string> = {
  unsafe_source: '#include "/etc/passwd": absolute paths and \'..\' are not allowed',
  library_not_available: "library 'FastLED' is not available (allowed: EEPROM, Servo)",
  missing_include: 'NoSuchLib.h: No such file or directory',
  missing_setup_loop: "undefined reference to `loop'",
  undefined_reference: "undefined reference to `helper()'",
  multiple_definition: "multiple definition of `speed'",
  flash_overflow: "region `text' overflowed by 7296 bytes",
  ram_overflow: "region `data' overflowed by 120 bytes",
  low_memory: 'low memory available: global variables use 83% of RAM; stability problems may occur',
  stray_character: "stray '\\333' in program",
  missing_quote: 'missing terminating " character',
  unterminated_comment: 'unterminated comment',
  invalid_directive: 'invalid preprocessing directive #inclde',
  missing_semicolon_after_type: "expected ';' after struct definition",
  missing_semicolon: "expected ';' before '}' token",
  missing_closing_brace: "expected '}' at end of input",
  extra_closing_brace: "expected declaration before '}' token",
  function_inside_function: "a function-definition is not allowed here before '{' token",
  missing_parenthesis: "expected ')' before ';' token",
  expected_expression: "expected primary-expression before ')' token",
  expected_unqualified_id: "expected unqualified-id before 'if'",
  expected_initializer: "expected initializer before 'void'",
  expected_constructor: "expected constructor, destructor, or type conversion before '(' token",
  else_without_if: "'else' without a previous 'if'",
  break_outside_loop: 'break statement not within loop or switch',
  continue_outside_loop: 'continue statement not within a loop',
  case_outside_switch: "case label '1' not within a switch statement",
  jump_to_case_label: 'jump to case label [-fpermissive]',
  duplicate_case: 'duplicate case value',
  case_sensitive_name: "'digitalwrite' was not declared in this scope",
  undeclared_name: "'ledPin' was not declared in this scope",
  not_a_type: "'Servo' does not name a type",
  missing_return_type: "ISO C++ forbids declaration of 'blink' with no type [-fpermissive]",
  redefinition: "redefinition of 'int speed'",
  no_member: "'class HardwareSerial' has no member named 'printn'",
  ambiguous_overload: "call of overloaded 'println(long long int)' is ambiguous",
  too_few_arguments: "too few arguments to function 'void move(int, int)'",
  too_many_arguments: "too many arguments to function 'void stop()'",
  no_matching_function: "no matching function for call to 'Servo::attach()'",
  invalid_conversion: "invalid conversion from 'const char*' to 'int' [-fpermissive]",
  cannot_convert: "cannot convert 'String' to 'const char*' for argument '1'",
  incompatible_assignment: "incompatible types in assignment of 'const char [6]' to 'char [10]'",
  invalid_operands: "invalid operands of types 'const char [7]' and 'int' to binary 'operator+'",
  lvalue_required: 'lvalue required as left operand of assignment',
  void_value_used: 'void value not ignored as it ought to be',
  return_value_in_void: "return-statement with a value, in function returning 'void' [-fpermissive]",
  array_too_large: "size of array 'big' is too large",
  array_size_not_constant: "array bound is not an integer constant before ']' token",
  invalid_subscript: "invalid types 'int[int]' for array subscript",
  narrowing_conversion: "narrowing conversion of '2.5e+0' from 'double' to 'int' inside { } [-Wnarrowing]",
  assignment_in_condition: 'suggest parentheses around assignment used as truth value [-Wparentheses]',
  no_return_value: 'no return statement in function returning non-void [-Wreturn-type]',
  uninitialized_variable: "'x' is used uninitialized in this function [-Wuninitialized]",
  unused_variable: "unused variable 'x' [-Wunused-variable]",
  signed_unsigned_compare: 'comparison between signed and unsigned integer expressions [-Wsign-compare]',
  constant_overflow: 'overflow in implicit constant conversion [-Woverflow]',
  division_by_zero: 'division by zero [-Wdiv-by-zero]',
  string_literal_compare: 'comparison with string literal results in unspecified behaviour [-Waddress]',
  statement_no_effect: 'statement has no effect [-Wunused-value]',
};

describe('beginner error catalogue (FR-COD-03)', () => {
  it('covers at least the 50 most common errors', () => {
    expect(EXPLANATION_KEYS.length).toBeGreaterThanOrEqual(50);
  });

  it.each(EXPLANATION_KEYS)('%s: a real message maps to it', (key) => {
    const sample = SAMPLES[key];
    expect(sample, `add a sample message for ${key}`).toBeDefined();
    expect(explain(sample ?? '')).toBe(key);
  });

  it.each(EXPLANATION_KEYS)('%s: has a Persian and an English explanation (AC2)', (key) => {
    for (const locale of ['en', 'fa'] as const) {
      const text = (resources[locale].build.explain as Record<string, string>)[key];
      expect(text, `${locale} build:explain.${key}`).toMatch(/\S{3}/);
    }
  });

  it('has no explanation text without a key (catalogue and locale stay in sync)', () => {
    expect(Object.keys(resources.en.build.explain).sort()).toEqual([...EXPLANATION_KEYS].sort());
  });

  it('leaves unknown messages unexplained', () => {
    expect(explain('internal compiler error: Segmentation fault')).toBeUndefined();
  });
});
