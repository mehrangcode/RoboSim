import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { main } from '../src/main.js';

const golden = (name: string) => new URL(`../golden/${name}.job.json`, import.meta.url).pathname;

async function cli(...argv: string[]) {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (t) => (out += t), err: (t) => (err += t) });
  return { code, out, err };
}

describe('grader CLI', () => {
  it('grades a job file and writes the result and the gzip trace', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'robosim-grade-'));
    const r = await cli(
      golden('serial-echo'),
      '--out',
      join(dir, 'r.json'),
      '--trace',
      join(dir, 't.json.gz'),
    );
    expect(r).toMatchObject({ code: 0, err: '' });
    expect(r.out).toMatch(/outcome\s+unresolved/);
    expect(r.out).toMatch(/trace\s+31 samples, sha256 [0-9a-f]{64}/);
    const result = JSON.parse(readFileSync(join(dir, 'r.json'), 'utf8'));
    expect(result).toMatchObject({ endSlice: 3000, traceDigest: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(result.serial).toContain('HELLO');
    expect(result).not.toHaveProperty('trace');
    const trace = JSON.parse(gunzipSync(readFileSync(join(dir, 't.json.gz'))).toString('utf8'));
    expect(trace.samples).toHaveLength(31);
  });

  it('grades a bare exported input log for --max-seconds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'robosim-grade-'));
    const job = JSON.parse(readFileSync(golden('blink'), 'utf8'));
    writeFileSync(join(dir, 'log.json'), JSON.stringify(job.log));
    const r = await cli(join(dir, 'log.json'), '--max-seconds', '0.5', '--out', join(dir, 'r.json'));
    expect(r.code).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, 'r.json'), 'utf8')).endSlice).toBe(500);
  });

  it('exits 2 on invalid jobs, foreign engine versions and bad usage', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'robosim-grade-'));
    const job = JSON.parse(readFileSync(golden('blink'), 'utf8'));
    writeFileSync(join(dir, 'bad.json'), JSON.stringify({ ...job, maxSimSeconds: 9999 }));
    writeFileSync(
      join(dir, 'old.json'),
      JSON.stringify({ ...job, log: { ...job.log, engineVersion: 'sim-core@0.0.1' } }),
    );
    expect((await cli(join(dir, 'bad.json'))).code).toBe(2);
    const old = await cli(join(dir, 'old.json'));
    expect(old).toMatchObject({ code: 2, err: expect.stringContaining('this grader runs') });
    expect((await cli()).code).toBe(2);
    expect((await cli('--help')).code).toBe(0);
  });
});
