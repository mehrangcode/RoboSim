// FR-COD-03: plain-language FA/EN explanations for common beginner errors. Each key has text under
// `build:explain.<key>` in both locales (content test). Order matters: the first matching pattern wins.

const ARDUINO_NAMES = [
  'pinMode',
  'digitalWrite',
  'digitalRead',
  'analogWrite',
  'analogRead',
  'delay',
  'delayMicroseconds',
  'millis',
  'micros',
  'pulseIn',
  'tone',
  'noTone',
  'map',
  'constrain',
  'attachInterrupt',
  'Serial',
  'HIGH',
  'LOW',
  'INPUT',
  'OUTPUT',
  'INPUT_PULLUP',
  'LED_BUILTIN',
  'setup',
  'loop',
];
const BY_LOWER = new Map(ARDUINO_NAMES.map((n) => [n.toLowerCase(), n]));

export const EXPLANATIONS: ReadonlyArray<readonly [key: string, pattern: RegExp]> = [
  // Our own guards and library resolution.
  ['unsafe_source', /^(#include|#import|assembler directive).*(is|are) not allowed|needs a literal <file>/],
  ['library_not_available', /^library '.*' (is not available|version)/],
  ['missing_include', /: No such file or directory$/],
  // Linker.
  ['missing_setup_loop', /undefined reference to `(setup|loop)'/],
  ['undefined_reference', /undefined reference to/],
  ['multiple_definition', /multiple definition of/],
  ['flash_overflow', /region `text' overflowed|will not fit in region `text'|sketch too big/],
  ['ram_overflow', /region `data' overflowed|will not fit in region `data'/],
  ['low_memory', /^low memory available/],
  // Lexical.
  ['stray_character', /stray '.*' in program/],
  ['missing_quote', /missing terminating ["'] character/],
  ['unterminated_comment', /unterminated comment/],
  ['invalid_directive', /invalid preprocessing directive/],
  // Structure and punctuation.
  ['missing_semicolon_after_type', /expected ';' after (class|struct|union) definition/],
  ['missing_semicolon', /expected ';' before|expected ';' at end of|expected ',' or ';' before/],
  ['missing_closing_brace', /expected '}' at end of input/],
  ['extra_closing_brace', /expected declaration before '}' token/],
  ['function_inside_function', /a function-definition is not allowed here/],
  ['missing_parenthesis', /expected '\)' before|expected '\(' before/],
  ['expected_expression', /expected primary-expression before/],
  ['expected_unqualified_id', /expected unqualified-id before/],
  ['expected_initializer', /expected initializer before/],
  ['expected_constructor', /expected constructor, destructor, or type conversion before/],
  ['else_without_if', /'else' without a previous 'if'/],
  ['break_outside_loop', /break statement not within loop or switch/],
  ['continue_outside_loop', /continue statement not within a loop/],
  ['case_outside_switch', /case label .* not within a switch statement|'default' label not within a switch/],
  ['jump_to_case_label', /jump to case label|crosses initialization of/],
  ['duplicate_case', /duplicate case value/],
  // Names and declarations.
  ['undeclared_name', /was not declared in this scope/],
  ['not_a_type', /does not name a type/],
  ['missing_return_type', /ISO C\+\+ forbids declaration of .* with no type/],
  ['redefinition', /redefinition of|conflicting declaration|previously declared here/],
  ['no_member', /has no member named/],
  ['ambiguous_overload', /call of overloaded .* is ambiguous/],
  // Calls and types.
  ['too_few_arguments', /too few arguments to function/],
  ['too_many_arguments', /too many arguments to function/],
  ['no_matching_function', /no matching function for call to/],
  ['invalid_conversion', /invalid conversion from/],
  ['cannot_convert', /cannot convert/],
  ['incompatible_assignment', /incompatible types in assignment of/],
  ['invalid_operands', /invalid operands of types/],
  ['lvalue_required', /lvalue required as (left|increment|decrement) operand/],
  ['void_value_used', /void value not ignored as it ought to be/],
  ['return_value_in_void', /return-statement with a value, in function returning 'void'/],
  ['array_too_large', /size of array .* is too large|size of array .* is negative/],
  ['array_size_not_constant', /array bound is not an integer constant|storage size of .* isn't known/],
  [
    'invalid_subscript',
    /invalid types .* for array subscript|subscripted value is neither array nor pointer/,
  ],
  ['narrowing_conversion', /narrowing conversion of/],
  // Warnings that hide real bugs.
  ['assignment_in_condition', /suggest parentheses around assignment used as truth value/],
  [
    'no_return_value',
    /no return statement in function returning non-void|control reaches end of non-void function/,
  ],
  ['uninitialized_variable', /is used uninitialized|may be used uninitialized/],
  ['unused_variable', /unused variable|variable .* set but not used/],
  [
    'signed_unsigned_compare',
    /comparison between signed and unsigned|comparison of integer expressions of different signedness/,
  ],
  [
    'constant_overflow',
    /overflow in implicit constant conversion|large integer implicitly truncated|integer overflow in expression|overflow in conversion from/,
  ],
  ['division_by_zero', /division by zero/],
  ['string_literal_compare', /comparison with string literal results in unspecified behaviou?r/],
  ['statement_no_effect', /statement has no effect/],
];

export const EXPLANATION_KEYS: readonly string[] = [
  ...new Set(['case_sensitive_name', ...EXPLANATIONS.map(([k]) => k)]),
];

/** Explanation key for a compiler/linker message, if it is a catalogued beginner error. */
export function explain(message: string): string | undefined {
  const undeclared = /'([A-Za-z_]\w*)' was not declared in this scope/.exec(message);
  const name = undeclared?.[1];
  if (name) {
    const known = BY_LOWER.get(name.toLowerCase());
    if (known && known !== name) return 'case_sensitive_name';
  }
  return EXPLANATIONS.find(([, pattern]) => pattern.test(message))?.[0];
}
