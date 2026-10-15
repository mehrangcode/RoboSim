import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildRequestSchema, type BuildRequestInput } from '@robosim/shared';
import { Compiler, type CompileOutput } from '../src/compiler.js';
import { DEFAULT_TOOLCHAIN_DIR } from '../src/toolchain.js';
import { sandboxRunner } from '../src/runner.js';

let cacheDir: string;
let compiler: Compiler;

beforeAll(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'robosim-compiler-test-'));
  compiler = await Compiler.create({ cacheDir, sandbox: true });
});
afterAll(() => rm(cacheDir, { recursive: true, force: true }));

const build = (input: Omit<BuildRequestInput, 'board'> & { board?: 'avr-uno' }): Promise<CompileOutput> =>
  compiler.build(buildRequestSchema.parse({ board: 'avr-uno', ...input }));
const sketch = (content: string, name = 'sketch.ino'): Promise<CompileOutput> =>
  build({ files: [{ name, content }] });
const errors = (r: CompileOutput) => r.diagnostics.filter((d) => d.severity === 'error');
const firstError = (r: CompileOutput) => {
  const [e] = errors(r);
  if (!e) throw new Error(`expected an error, got ${JSON.stringify(r.diagnostics)}`);
  return e;
};
const artifactOf = (r: CompileOutput) => {
  if (!r.artifact) throw new Error(`build failed: ${JSON.stringify(r.diagnostics)}`);
  return r.artifact;
};

const BLINK =
  'void setup() { pinMode(13, OUTPUT); }\nvoid loop() { digitalWrite(13, !digitalRead(13)); delay(500); }\n';

describe('successful builds', () => {
  it('compiles blink to Intel HEX with a size report and serves the artifact', async () => {
    const r = await sketch(BLINK);
    expect(r.status).toBe('succeeded');
    expect(r.diagnostics).toEqual([]);
    expect(artifactOf(r).size.flashBytes).toBeGreaterThan(500);
    expect(artifactOf(r).size.flashPct).toBeLessThan(5);
    const hex = await compiler.readArtifact(artifactOf(r).sha256);
    expect(hex).toMatch(/^:10000000/);
    expect(hex).toMatch(/:00000001FF\n$/);
  });

  it('is content-addressed: whitespace-only and line-ending changes hit the cache', async () => {
    const first = await sketch('void setup() {}\nvoid loop() {}\n');
    const second = await sketch('void setup() {}   \r\nvoid loop() {}\r\n');
    expect(second.cacheHit).toBe(true);
    expect(second.cacheKey).toBe(first.cacheKey);
    expect(second.artifact).toEqual(first.artifact);
  });

  it('is deterministic: sandboxed and direct builds produce the same HEX', async () => {
    const direct = await Compiler.create({
      cacheDir: await mkdtemp(join(tmpdir(), 'robosim-direct-')),
      sandbox: false,
    });
    const a = await sketch(BLINK);
    const b = await direct.build(
      buildRequestSchema.parse({ board: 'avr-uno', files: [{ name: 'sketch.ino', content: BLINK }] }),
    );
    expect(artifactOf(b).sha256).toBe(artifactOf(a).sha256);
  });

  it.each([
    ['Servo', '#include <Servo.h>\nServo s;\nvoid setup() { s.attach(9); }\nvoid loop() { s.write(90); }'],
    [
      'NewPing',
      '#include <NewPing.h>\nNewPing sonar(7, 8, 200);\nvoid setup() { Serial.begin(9600); }\nvoid loop() { Serial.println(sonar.ping_cm()); }',
    ],
    ['EEPROM', '#include <EEPROM.h>\nvoid setup() { EEPROM.write(0, 42); }\nvoid loop() {}'],
    ['SPI', '#include <SPI.h>\nvoid setup() { SPI.begin(); SPI.transfer(1); }\nvoid loop() {}'],
    [
      'SoftwareSerial',
      '#include <SoftwareSerial.h>\nSoftwareSerial bt(10, 11);\nvoid setup() { bt.begin(9600); }\nvoid loop() { bt.println("hi"); }',
    ],
    [
      'Wire',
      '#include <Wire.h>\nvoid setup() { Wire.begin(); Wire.beginTransmission(8); Wire.endTransmission(); }\nvoid loop() {}',
    ],
  ])('links the %s library from its #include', async (lib, src) => {
    const r = await sketch(src);
    expect(errors(r)).toEqual([]);
    expect(r.status).toBe('succeeded');
    expect(r.libraries.map((l) => l.name)).toContain(lib);
  });

  it('builds multi-file sketches: extra .ino tabs, a .cpp and a quoted header', async () => {
    const r = await build({
      files: [
        {
          name: 'robot.ino',
          content: '#include "motor.h"\nvoid setup() { blinkTwice(); motorInit(); }\nvoid loop() {}\n',
        },
        { name: 'helpers.ino', content: 'void blinkTwice() { pinMode(13, OUTPUT); }\n' },
        { name: 'motor.h', content: '#pragma once\nvoid motorInit();\n' },
        {
          name: 'motor.cpp',
          content: '#include <Arduino.h>\n#include "motor.h"\nvoid motorInit() { pinMode(5, OUTPUT); }\n',
        },
      ],
    });
    expect(r.diagnostics).toEqual([]);
    expect(r.status).toBe('succeeded');
  });

  it('accepts a declared library at its pinned version', async () => {
    const r = await build({
      files: [{ name: 's.ino', content: BLINK }],
      libraries: [{ name: 'Servo', version: '1.3.0' }],
    });
    expect(r.status).toBe('succeeded');
    expect(r.libraries).toEqual([{ name: 'Servo', version: '1.3.0' }]);
  });

  it('warns about low memory above 75 % RAM', async () => {
    const r = await sketch(
      'byte buf[1700];\nvoid setup() { buf[0] = 1; Serial.begin(9600); Serial.write(buf, sizeof buf); }\nvoid loop() {}',
    );
    expect(r.status).toBe('succeeded');
    expect(r.diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'warning', explanationKey: 'low_memory' }),
    );
  });
});

describe("diagnostics map to the user's files and lines", () => {
  it('reports a missing semicolon on the user line with an explanation (User Stories FR-COD-03 AC1)', async () => {
    const lines = Array.from({ length: 11 }, (_, k) => `// line ${k + 1}`);
    const r = await sketch([...lines, 'void setup() { int x = 1 }', 'void loop() {}'].join('\n'));
    expect(r.status).toBe('failed');
    expect(errors(r)[0]).toMatchObject({
      file: 'sketch.ino',
      line: 12,
      severity: 'error',
      explanationKey: 'missing_semicolon',
    });
  });

  it('maps errors in a second .ino tab and in a .cpp file', async () => {
    const r = await build({
      files: [
        { name: 'main.ino', content: 'void setup() {}\nvoid loop() {}\n' },
        { name: 'tab.ino', content: '\n\nvoid f() { pinmode(3, OUTPUT); }\n' },
        { name: 'util.cpp', content: '#include <Arduino.h>\n\nint g() { return undefinedThing; }\n' },
      ],
    });
    expect(errors(r).map((d) => [d.file, d.line, d.explanationKey])).toEqual([
      ['tab.ino', 3, 'case_sensitive_name'],
      ['util.cpp', 3, 'undeclared_name'],
    ]);
  });

  it('explains a missing setup()/loop() at link time', async () => {
    const r = await sketch('void setup() {}\n');
    expect(r.status).toBe('failed');
    expect(errors(r)[0]).toMatchObject({ file: '', explanationKey: 'missing_setup_loop' });
    expect(firstError(r).message).toContain("undefined reference to `loop'");
  });

  it('explains an undefined function at link time', async () => {
    const r = await sketch('void helper();\nvoid setup() { helper(); }\nvoid loop() {}\n');
    expect(errors(r)[0]).toMatchObject({ explanationKey: 'undefined_reference' });
  });

  it('fails a sketch that does not fit in flash', async () => {
    const r = await sketch(
      [
        'const byte a[20000] PROGMEM = {1};',
        'const byte b[20000] PROGMEM = {2};',
        'void setup() { Serial.begin(9600); int i = analogRead(A0); Serial.write(pgm_read_byte(&a[i]) + pgm_read_byte(&b[i])); }',
        'void loop() {}',
      ].join('\n'),
    );
    expect(r.status).toBe('failed');
    expect(errors(r).some((d) => d.explanationKey === 'flash_overflow')).toBe(true);
  });

  it('reports a missing header with an explanation and no host paths', async () => {
    const r = await sketch('#include <NoSuchLib.h>\nvoid setup() {}\nvoid loop() {}');
    expect(errors(r)[0]).toMatchObject({ file: 'sketch.ino', line: 1, explanationKey: 'missing_include' });
    expect(JSON.stringify(r.diagnostics)).not.toMatch(/\/srv|\/opt|\/tmp|\/mnt|\/home/);
  });
});

describe('guards', () => {
  it.each([
    ['#include "/etc/passwd"\n', 'absolute paths'],
    ['#include <../../../etc/passwd>\n', 'absolute paths'],
    ['#define F <stdio.h>\n#include F\n', 'needs a literal'],
    ['#include_next <Arduino.h>\n', 'not allowed'],
    ['asm(".incbin \\"/etc/hostname\\"");\n', "'.incbin'"],
  ])('refuses %j before compiling', async (src, message) => {
    const r = await sketch(`${src}void setup() {}\nvoid loop() {}\n`);
    expect(r.status).toBe('failed');
    expect(errors(r)[0]).toMatchObject({ explanationKey: 'unsafe_source' });
    expect(firstError(r).message).toContain(message);
  });

  it('rejects libraries that are not on the allow-list or at another version', async () => {
    const unknown = await build({
      files: [{ name: 's.ino', content: BLINK }],
      libraries: [{ name: 'FastLED', version: '3.6.0' }],
    });
    expect(errors(unknown)[0]).toMatchObject({ explanationKey: 'library_not_available' });
    const version = await build({
      files: [{ name: 's.ino', content: BLINK }],
      libraries: [{ name: 'Servo', version: '1.1.0' }],
    });
    expect(firstError(version).message).toContain('have 1.3.0');
  });

  it('enforces the build time limit', async () => {
    const slow = await Compiler.create({ cacheDir, sandbox: true, timeoutMs: 1 });
    const r = await slow.build(
      buildRequestSchema.parse({ board: 'avr-uno', files: [{ name: 'x.ino', content: `${BLINK}// t\n` }] }),
    );
    expect(firstError(r).message).toContain('time limit');
  });

  it('sandbox: no network, no home or project files, private /proc', async () => {
    const work = await mkdtemp(join(tmpdir(), 'robosim-sbx-'));
    await writeFile(join(work, 'f'), 'ok');
    const run = sandboxRunner({ work, toolchain: DEFAULT_TOOLCHAIN_DIR, prebuilt: work });
    const deadline = Date.now() + 10_000;
    const sh = (cmd: string) => run.run(['sh', '-c', cmd], { cwd: work, deadline });
    expect((await sh('cat f')).output).toBe('ok');
    expect((await sh(`ls -A /home /mnt /root | grep -v :`)).output.trim()).toBe('');
    expect((await sh(`cat ${JSON.stringify(join(process.cwd(), 'package.json'))}`)).code).not.toBe(0);
    expect((await sh('ls /proc | grep -E "^[0-9]+$" | wc -l')).output.trim()).toMatch(/^[1-5]$/);
    // Fresh network namespace: loopback only (and down), no route out.
    expect((await sh('ip -o link')).output.trim()).toMatch(/^1: lo: .*state DOWN/);
    expect((await sh('touch /opt/x')).code).not.toBe(0);
    await rm(work, { recursive: true, force: true });
  });
});
