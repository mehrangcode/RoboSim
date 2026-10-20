import {
  ENGINE_VERSION,
  MAX_SIM_SECONDS,
  TRACE_INTERVAL_SLICES,
  builtinSource,
  grade,
} from '@robosim/sim-runtime';
import { describe, expect, it } from 'vitest';
import { parseGradeJob } from '../src/job.js';

// Minutes of CPU, so not in `pnpm test`: run by `pnpm test:sim` (vitest.long.config.ts).
describe('grader robustness: long runs', () => {
  it('a sketch printing for the whole cap ends exactly at MAX_SIM_SECONDS with a bounded trace', () => {
    const r = grade(
      parseGradeJob({
        log: {
          engineVersion: ENGINE_VERSION,
          scenario: 'serial',
          ...builtinSource('serial'),
          seed: 1,
          entries: [],
        },
        maxSimSeconds: MAX_SIM_SECONDS,
      }),
    );
    expect(r).toMatchObject({ outcome: 'unresolved', endSlice: MAX_SIM_SECONDS * 1000 });
    expect(r.trace.samples).toHaveLength((MAX_SIM_SECONDS * 1000) / TRACE_INTERVAL_SLICES + 1);
    // Still printing at the end of the cap, and nothing truncated.
    expect(r.trace.serial.at(-1)?.slice).toBeGreaterThan((MAX_SIM_SECONDS - 5) * 1000);
    expect(r.serialTruncated).toBeUndefined();
  }, 300_000);
});
