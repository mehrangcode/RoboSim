import { grade, type GradeJob } from '@robosim/sim-runtime';
import { codeAnalysisReady } from './code-analysis.browser.js';

// Grades one job off the main thread, as the editor's Verify does.
const scope = self as unknown as { postMessage(message: unknown): void };
self.onmessage = async (e: MessageEvent<GradeJob>) => {
  await codeAnalysisReady;
  scope.postMessage(grade(e.data));
};
