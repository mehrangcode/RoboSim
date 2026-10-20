import { grade, type GradeJob } from '@robosim/sim-runtime';

// Grades one job off the main thread, as the editor's Verify does.
const scope = self as unknown as { postMessage(message: unknown): void };
self.onmessage = (e: MessageEvent<GradeJob>) => scope.postMessage(grade(e.data));
