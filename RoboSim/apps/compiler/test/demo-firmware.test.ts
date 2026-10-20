import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { FIRMWARE_SETS } from '../scripts/firmware-sets.js';
import { Compiler } from '../src/compiler.js';
import { demoBuildRequest } from '../src/demo.js';

const cacheDir = await mkdtemp(join(tmpdir(), 'robosim-demo-drift-'));
afterAll(() => rm(cacheDir, { recursive: true, force: true }));

describe.each(FIRMWARE_SETS)('$name firmware', (set) => {
  it.each(Object.keys(set.sketches))(
    '%s: generated.ts is the HEX of its sketch (run pnpm firmware:gen after editing sketches.ts)',
    async (id) => {
      const compiler = await Compiler.create({ cacheDir, sandbox: false });
      const r = await compiler.build(demoBuildRequest(set.sketches[id] ?? ''));
      expect(r.diagnostics).toEqual([]);
      const generated = await readFile(new URL(`../../../${set.target}`, import.meta.url), 'utf8');
      const hex = await compiler.readArtifact(r.artifact?.sha256 ?? '');
      expect(generated).toContain(`'${(hex ?? '').replaceAll('\n', '\\n')}'`);
    },
  );
});
