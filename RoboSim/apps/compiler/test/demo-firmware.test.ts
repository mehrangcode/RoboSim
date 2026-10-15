import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
// Plain data modules, imported from source so this app does not depend on the engine build.
import { FIRMWARE_HEX } from '../../../packages/sim-runtime/src/firmware/generated.js';
import { FIRMWARE_SKETCHES } from '../../../packages/sim-runtime/src/firmware/sketches.js';
import { Compiler } from '../src/compiler.js';
import { demoBuildRequest } from '../src/demo.js';

const cacheDir = await mkdtemp(join(tmpdir(), 'robosim-demo-drift-'));
afterAll(() => rm(cacheDir, { recursive: true, force: true }));

describe('built-in demo firmware', () => {
  it.each(Object.keys(FIRMWARE_SKETCHES) as Array<keyof typeof FIRMWARE_SKETCHES>)(
    '%s: generated.ts is the HEX of its sketch (run pnpm firmware:gen after editing sketches.ts)',
    async (id) => {
      const compiler = await Compiler.create({ cacheDir, sandbox: false });
      const r = await compiler.build(demoBuildRequest(FIRMWARE_SKETCHES[id]));
      expect(r.diagnostics).toEqual([]);
      expect(await compiler.readArtifact(r.artifact?.sha256 ?? '')).toBe(FIRMWARE_HEX[id]);
    },
  );
});
