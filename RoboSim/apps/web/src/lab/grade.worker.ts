// Verified-run worker (Technical Design §11.1): grades a run headless and unpaced, the way
// apps/grader does, without stalling the live simulation worker.
import { grade, traceDigest, type GradeJob } from '@robosim/sim-runtime';
import { codeAnalysisReady } from './code-analysis.js';
import type { VerifyReply } from './use-verified-run.js';

const reply = (msg: VerifyReply) => self.postMessage(msg);

self.onmessage = async (event: MessageEvent<GradeJob>) => {
  try {
    await codeAnalysisReady;
    const started = performance.now();
    const { trace, ...result } = grade(event.data);
    const wallMs = performance.now() - started;
    reply({
      type: 'graded',
      result,
      samples: trace.samples.length,
      digest: await traceDigest(trace),
      wallMs,
    });
  } catch (e) {
    reply({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};
