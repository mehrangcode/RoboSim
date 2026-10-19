import { describe, expect, it } from 'vitest';
import { includedNames, scanSources } from './includes.js';

describe('include scanning', () => {
  it('reads #include lines of CRLF files (libraries written on Windows)', () => {
    expect(includedNames('#ifndef X_h\r\n#include "Print.h" \r\n#include <Wire.h>\r\n')).toEqual([
      'Print.h',
      'Wire.h',
    ]);
  });

  it('refuses unsafe includes in CRLF sketches too', () => {
    const { includes, errors } = scanSources([
      { name: 'sketch.ino', content: '#include <Wire.h>\r\n#include "/etc/passwd"\r\nvoid setup() {}\r\n' },
    ]);
    expect(includes.map((i) => [i.name, i.line])).toEqual([['Wire.h', 1]]);
    expect(errors.map((e) => e.line)).toEqual([2]);
  });
});
