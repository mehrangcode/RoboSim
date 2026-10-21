import { describe, expect, it } from 'vitest';
import { commands } from 'vitest/browser';
import { ENGINE_VERSION, grade, type GradeJob, type GradeResult } from '@robosim/sim-runtime';
import { GOLDEN_FIXTURES, firstDifference } from '../src/golden.js';
import { parseGradeJob } from '../src/job.js';
import { codeAnalysisReady } from './code-analysis.browser.js';

/*
 * Golden traces in the browser (P1 exit: Node, Chrome and Firefox): every committed job graded on the
 * page's main thread, and the heaviest ones again inside a Web Worker as the editor runs them, must give
 * the committed result bit for bit. Recording stays in Node (`pnpm golden:update`).
 */
const read = async (file: string): Promise<unknown> => JSON.parse(await commands.readFile(`golden/${file}`));
async function golden(name: string) {
  await codeAnalysisReady; // loading a project runs the code-aware safety rules
  return {
    job: parseGradeJob(await read(`${name}.job.json`)),
    recorded: (await read(`${name}.result.json`)) as GradeResult,
  };
}

describe.each(GOLDEN_FIXTURES)('golden trace $name in the browser', ({ name }) => {
  it('reproduces the committed result bit for bit', async () => {
    const { job, recorded } = await golden(name);
    expect(recorded.engineVersion).toBe(ENGINE_VERSION);
    expect(firstDifference(recorded, grade(job))).toBeNull();
  });
});

const inWorker = (job: GradeJob) =>
  new Promise<GradeResult>((resolve, reject) => {
    const worker = new Worker(new URL('./grade.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<GradeResult>) => (worker.terminate(), resolve(e.data));
    worker.onerror = (e) => (worker.terminate(), reject(new Error(e.message)));
    worker.postMessage(job);
  });

describe('golden traces in a Web Worker', () => {
  it.each(['line-follower-lap', 'laser-avoider', 'sumo-bot', 'timer-555', 'neopixel-rainbow'])(
    '%s',
    async (name) => {
      const { job, recorded } = await golden(name);
      expect(firstDifference(recorded, await inWorker(job))).toBeNull();
    },
  );
});
