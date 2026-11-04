// Simulation Web Worker (Technical Design §5.8): the engine never runs on the UI thread.
import { SimHost, type MainToWorker, type WorkerToMain } from '@robosim/sim-runtime';
import { codeAnalysisReady } from './code-analysis.js';

const host = new SimHost(
  (msg: WorkerToMain, transfer: ArrayBuffer[] = []) => self.postMessage(msg, { transfer }),
  () => performance.now(),
  // Shared snapshots need cross-origin isolation (COOP/COEP); otherwise buffers are transferred.
  { shared: typeof SharedArrayBuffer !== 'undefined' && self.crossOriginIsolated },
);

// Loading a project runs the code-aware safety rules: commands wait (in order) for the parser.
self.onmessage = (event: MessageEvent<MainToWorker>) =>
  void codeAnalysisReady.then(
    () => host.handle(event.data),
    (e: unknown) =>
      self.postMessage({ type: 'error', message: `code analysis failed to load: ${String(e)}` }),
  );

/** Tick period (ms). The tick's own work counts towards it: the pacer simulates ≤ 12 ms of each 16. */
const TICK_MS = 16;

function loop(): void {
  const start = performance.now();
  host.tick();
  // Sleeping a full period after the work capped the worker at 12 of every 28 ms (RTF < 1× for any
  // demo above ≈ 0.43 ms/slice). The rest of the period stays free for incoming messages.
  setTimeout(loop, Math.max(0, TICK_MS - (performance.now() - start)));
}
loop();
