#!/usr/bin/env node
// Grader CLI (Technical Design §11.1): verified run of one job file, headless and unpaced.
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';
import { initCodeAnalysis } from '@robosim/code-analysis';
import { nodeCodeAnalysisWasm } from '@robosim/code-analysis/node';
import { MAX_SIM_SECONDS, grade, traceDigest } from '@robosim/sim-runtime';
import { parseGradeJob } from './job.js';

const USAGE = `Usage: robosim-grade <job.json> [--max-seconds N] [--out result.json] [--trace trace.json.gz]

  job.json        A grade job { log, maxSimSeconds } or an exported input log.
  --max-seconds   Simulated-time cap for a bare input log (default ${MAX_SIM_SECONDS}).
  --out           Write the full result (without the trace) as JSON.
  --trace         Write the trace as gzip JSON (object storage format).

Exit codes: 0 graded, 1 graded but the challenge failed, 2 invalid job or engine error.`;

export interface Io {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

/** Runs the CLI; returns the exit code. */
export async function main(argv: readonly string[], io: Io): Promise<number> {
  let args;
  try {
    args = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        'max-seconds': { type: 'string' },
        out: { type: 'string' },
        trace: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (e) {
    io.err(`${(e as Error).message}\n${USAGE}\n`);
    return 2;
  }
  const file = args.positionals[0];
  if (args.values.help || !file || args.positionals.length > 1) {
    (args.values.help ? io.out : io.err)(`${USAGE}\n`);
    return args.values.help ? 0 : 2;
  }
  try {
    const cap = args.values['max-seconds'];
    const job = parseGradeJob(
      JSON.parse(await readFile(file, 'utf8')),
      cap === undefined ? undefined : Number(cap),
    );
    await initCodeAnalysis(nodeCodeAnalysisWasm()); // code-aware safety rules (FR-SAF-03)
    const started = performance.now();
    const result = grade(job);
    const wallMs = performance.now() - started;
    const { trace, ...summary } = result;
    const digest = await traceDigest(trace);
    if (args.values.out)
      await writeFile(args.values.out, `${JSON.stringify({ ...summary, traceDigest: digest }, null, 2)}\n`);
    if (args.values.trace) await writeFile(args.values.trace, gzipSync(JSON.stringify(trace)));
    const simSeconds = result.endSlice / 1000;
    io.out(
      [
        `outcome   ${result.outcome}${result.challenge?.decidedAt != null ? ` at ${result.challenge.decidedAt} s` : ''}`,
        ...(result.score ? [`score     ${result.score.total}/${result.score.max}`] : []),
        `simulated ${simSeconds} s in ${(wallMs / 1000).toFixed(2)} s (${(simSeconds / (wallMs / 1000)).toFixed(1)}× real time)`,
        `findings  ${[...result.staticFindings, ...trace.findings].map((f) => f.ruleId).join(', ') || 'none'}`,
        `engine    ${result.engineVersion}`,
        `trace     ${trace.samples.length} samples, sha256 ${digest}`,
        '',
      ].join('\n'),
    );
    return result.outcome === 'failure' ? 1 : 0;
  } catch (e) {
    io.err(`grade failed: ${e instanceof Error ? e.message : String(e)}\n`);
    return 2;
  }
}

if (import.meta.main)
  process.exitCode = await main(process.argv.slice(2), {
    out: (t) => process.stdout.write(t),
    err: (t) => process.stderr.write(t),
  });
