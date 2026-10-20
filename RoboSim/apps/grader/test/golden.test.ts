import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION, SCENARIOS, grade, type GradeJob, type GradeResult } from '@robosim/sim-runtime';
import { GOLDEN_FIXTURES, firstDifference, fixtureJob, formatResult } from '../src/golden.js';
import { parseGradeJob } from '../src/job.js';

/*
 * Golden traces (Engineering Guide §6). `pnpm golden:update` records missing fixtures and
 * re-records after an `engineVersion` bump; it refuses to overwrite a changed trace otherwise.
 */
const UPDATE = process.env['UPDATE_GOLDEN'] === '1';
const dir = new URL('../golden/', import.meta.url);
const read = (file: URL): unknown => JSON.parse(readFileSync(file, 'utf8'));

describe.each(GOLDEN_FIXTURES)('golden trace $name', (fixture) => {
  const jobFile = new URL(`${fixture.name}.job.json`, dir);
  const resultFile = new URL(`${fixture.name}.result.json`, dir);

  it('reproduces the committed result bit for bit', () => {
    let job: GradeJob = existsSync(jobFile) ? parseGradeJob(read(jobFile)) : fixtureJob(fixture);
    const recorded = existsSync(resultFile) ? (read(resultFile) as GradeResult) : null;
    const bumped = recorded !== null && recorded.engineVersion !== ENGINE_VERSION;

    if (!UPDATE) {
      expect(recorded, `no golden result: run \`pnpm golden:update\``).not.toBeNull();
      expect(
        recorded?.engineVersion,
        'golden traces were recorded with another engine version: run `pnpm golden:update`',
      ).toBe(ENGINE_VERSION);
    }
    // The job file freezes project + firmware; only its engine stamp follows a bump.
    if (bumped || !existsSync(jobFile)) {
      job = { ...job, log: { ...job.log, engineVersion: ENGINE_VERSION } };
      if (UPDATE) writeFileSync(jobFile, `${JSON.stringify(job, null, 2)}\n`);
    }

    const actual = grade(job);
    const diff = recorded ? firstDifference(recorded, actual) : 'missing';
    if (UPDATE && (recorded === null || bumped)) {
      writeFileSync(resultFile, formatResult(actual));
      return;
    }
    expect(
      diff,
      `behaviour changed under the same engine version ${ENGINE_VERSION}: bump engineVersion (package versions) and run \`pnpm golden:update\``,
    ).toBeNull();
  });
});

describe('golden suite', () => {
  it('covers every built-in scenario: arena challenges, scripted inputs, serial and damage runs', () => {
    expect(new Set(GOLDEN_FIXTURES.map((f) => f.scenario))).toEqual(new Set(SCENARIOS));
    expect(new Set(GOLDEN_FIXTURES.map((f) => f.name)).size).toBe(GOLDEN_FIXTURES.length);
    expect(GOLDEN_FIXTURES.some((f) => f.entries.some((e) => e.kind === 'component'))).toBe(true);
    expect(GOLDEN_FIXTURES.some((f) => f.entries.some((e) => e.kind === 'serial'))).toBe(true);
  });
});
