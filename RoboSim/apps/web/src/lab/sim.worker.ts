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

function loop(): void {
  host.tick();
  setTimeout(loop, 16);
}
loop();
