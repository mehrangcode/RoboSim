import { describe, expect, it } from 'vitest';
import { findFunctionDefinitions, maskCode, preprocessSketch } from './preprocess.js';

const decls = (src: string): string[] => findFunctionDefinitions(src).map((d) => d.declaration);

describe('maskCode', () => {
  it('blanks comments, strings and directives but keeps offsets and newlines', () => {
    const src = '#define X {\nint a; // {\n/* } */ char *s = "}{";\nchar c = \'{\';';
    const masked = maskCode(src);
    expect(masked).toHaveLength(src.length);
    expect(masked.split('\n')).toHaveLength(4);
    expect(masked).not.toMatch(/[{}]/);
  });

  it('handles directive continuations and raw strings', () => {
    const masked = maskCode('#define F(x) \\\n  { x }\nconst char* r = R"x({ })x";');
    expect(masked).not.toMatch(/[{}]/);
  });
});

describe('findFunctionDefinitions', () => {
  it('finds top-level functions with their signatures', () => {
    expect(
      decls(`
int speed = 3;
void setup() { pinMode(13, OUTPUT); }
static unsigned long  elapsed(unsigned long since) { return millis() - since; }
const char* name(int i) { return "x"; }
void loop() { if (x) { y(); } }`),
    ).toEqual([
      'void setup();',
      'static unsigned long elapsed(unsigned long since);',
      'const char* name(int i);',
      'void loop();',
    ]);
  });

  it('drops default arguments from prototypes', () => {
    expect(decls('void beep(int ms = 100, const char* tag = "a,b") {}')).toEqual([
      'void beep(int ms, const char* tag);',
    ]);
  });

  it('skips non-functions: structs, class methods, initialisers, ISRs, lambdas, nested blocks', () => {
    expect(
      decls(`
struct P { int x; int get() { return x; } };
class Q { public: void f() {} };
void Q::g() {}
int table[] = {1, 2};
ISR(TIMER1_COMPA_vect) { count++; }
auto f = [](int v) { return v; };
namespace ns { void h() {} }
extern "C" { void c_fn() {} }
template <typename T> T twice(T v) { return v + v; }`),
    ).toEqual([]);
  });

  it('ignores braces in comments, strings and directives', () => {
    expect(decls('// void no() {\n#define B {\nconst char* s = "void x() {";\nvoid yes() {}')).toEqual([
      'void yes();',
    ]);
  });
});

describe('preprocessSketch', () => {
  it('declares functions before first use and maps lines back with #line', () => {
    const { code, prototypes } = preprocessSketch(
      [
        {
          name: 'robot.ino',
          content:
            '#include <Servo.h>\nServo s;\nvoid setup() { blink(2); }\nvoid loop() {}\nvoid blink(int n) {}\n',
        },
      ],
      'robot.ino',
    );
    expect(prototypes.map((p) => [p.line, p.declaration])).toEqual([
      [3, 'void setup();'],
      [4, 'void loop();'],
      [5, 'void blink(int n);'],
    ]);
    expect(code).toBe(
      [
        '#include <Arduino.h>',
        '#line 1 "robot.ino"',
        '#include <Servo.h>',
        'Servo s;',
        '#line 3 "robot.ino"',
        'void setup();',
        '#line 4 "robot.ino"',
        'void loop();',
        '#line 5 "robot.ino"',
        'void blink(int n);',
        '#line 3 "robot.ino"',
        'void setup() { blink(2); }',
        'void loop() {}',
        'void blink(int n) {}',
        '',
      ].join('\n'),
    );
  });

  it('merges extra .ino tabs after the main one, alphabetically, each with its own #line', () => {
    const { code } = preprocessSketch(
      [
        { name: 'zeta.ino', content: 'void z() {}' },
        { name: 'main.ino', content: 'void setup() { a(); z(); }\nvoid loop() {}' },
        { name: 'alpha.ino', content: 'void a() {}' },
      ],
      'main.ino',
    );
    const body = code.slice(code.indexOf('void setup() {'));
    expect(body).toBe(
      'void setup() { a(); z(); }\nvoid loop() {}\n#line 1 "alpha.ino"\nvoid a() {}\n#line 1 "zeta.ino"\nvoid z() {}\n',
    );
    expect(code).toContain('#line 1 "zeta.ino"\nvoid z();');
  });

  it('handles a sketch without functions', () => {
    expect(preprocessSketch([{ name: 's.ino', content: 'int x;' }], 's.ino').code).toBe(
      '#include <Arduino.h>\n#line 1 "s.ino"\nint x;\n',
    );
  });
});
