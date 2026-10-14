// Simulation Web Worker (Technical Design §5.8): the engine never runs on the UI thread.
import { SimHost, type MainToWorker, type WorkerToMain } from '@robosim/sim-runtime';

const host = new SimHost(
  (msg: WorkerToMain, transfer: ArrayBuffer[] = []) => self.postMessage(msg, { transfer }),
  () => performance.now(),
);

self.onmessage = (event: MessageEvent<MainToWorker>) => host.handle(event.data);

function loop(): void {
  host.tick();
  setTimeout(loop, 16);
}
loop();
