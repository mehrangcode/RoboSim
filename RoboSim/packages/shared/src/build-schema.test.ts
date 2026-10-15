import { describe, expect, it } from 'vitest';
import { BUILD_LIMITS, buildRequestSchema } from './build-schema.js';

const ok = {
  board: 'avr-uno',
  files: [{ name: 'sketch.ino', content: 'void setup() {}\nvoid loop() {}\n' }],
};
const issues = (input: unknown) => {
  const r = buildRequestSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};

describe('buildRequestSchema (API Spec §4.5, Security §5 input limits)', () => {
  it('accepts a sketch and defaults libraries to none', () => {
    expect(buildRequestSchema.parse(ok).libraries).toEqual([]);
  });

  it.each(['../x.ino', '/etc/x.ino', 'a b.ino', 'x.exe', 'x.ino\0.h', '.ino'])(
    'rejects the file name %j',
    (name) => {
      expect(issues({ ...ok, files: [{ name, content: '' }] })).toContain('files.0.name: invalid file name');
    },
  );

  it('needs an .ino file, unique names and at most 20 files', () => {
    expect(issues({ ...ok, files: [{ name: 'a.cpp', content: '' }] })).toContain(
      'files: a sketch needs at least one .ino file',
    );
    expect(issues({ ...ok, files: [...ok.files, { name: 'SKETCH.ino', content: '' }] })).toContain(
      'files.1.name: duplicate file name',
    );
    const many = Array.from({ length: BUILD_LIMITS.maxFiles + 1 }, (_, k) => ({
      name: `f${k}.ino`,
      content: '',
    }));
    expect(issues({ ...ok, files: many }).length).toBeGreaterThan(0);
  });

  it('caps the total size at 100 KB (UTF-8 bytes) and rejects null bytes', () => {
    const persian = 'ب'.repeat(51 * 1024); // 2 bytes each in UTF-8
    expect(issues({ ...ok, files: [{ name: 's.ino', content: persian }] })).toContain(
      `files: sources exceed ${BUILD_LIMITS.maxTotalBytes} bytes`,
    );
    expect(issues({ ...ok, files: [{ name: 's.ino', content: 'int x;\0' }] })).toContain(
      'files.0.content: null bytes are not allowed',
    );
  });

  it('only knows the boards the build service supports', () => {
    expect(issues({ ...ok, board: 'esp32' }).length).toBeGreaterThan(0);
  });
});
